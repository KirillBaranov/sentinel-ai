// runtime.ts
import { EnvelopeV1 } from "./schemas";
import { makeFindingId } from "./hash";
import { ResolvedAnalyticsConfig, AnalyticsClient, FindingPayload, RunFinishPayload } from "./types";
import { BaseCtx } from "./plugin/types";
import { Transport } from "./transport/file";
import { PluginHost } from "./plugin/host";
import { Hasher } from "./hash/hasher";

export class AnalyticsRuntime implements AnalyticsClient {
  private currentRunId?: string;
  private started = false;
  private finished = false;
  private seenFindingIds = new Set<string>();

  constructor(
    private ctx: BaseCtx,
    private cfg: ResolvedAnalyticsConfig,
    private transport: Transport,
    private plugins: PluginHost,
    private hasher: Hasher
  ) {}

  diagnostics() {
    return {
      enabled: this.cfg.enabled,
      mode: this.cfg.mode,
      outDir: this.cfg.outDir,
      currentFile: this.transport.currentFile?.(),
      privacy: this.cfg.privacy,
    };
  }

  async init() {
    if (!this.cfg.enabled) return;
    await this.plugins.init();
  }

  private envEnvelope(type: string) {
    return {
      v: 1 as const,
      type,
      ts: Date.now(),
      run_id: this.currentRunId!,
      project_id: this.hasher.projectId(this.ctx.projectRemoteUrl),
      commit_sha: this.ctx.commitSha,
      branch: this.ctx.branch,
      provider: this.ctx.provider,
      profile: this.ctx.profile,
      env: this.ctx.env || "dev",
      privacy: this.cfg.privacy,
    };
  }

  start(runId: string, payload?: Record<string, any>) {
    if (!this.cfg.enabled) return;

    // idempotent start
    if (this.started && this.currentRunId === runId) return;

    // reset per-run state
    this.currentRunId = runId;
    this.started = true;
    this.finished = false;
    this.seenFindingIds.clear();

    // rotate file when byRun
    if (this.cfg.mode === "byRun" && this.transport.rotateForRun) {
      this.transport.rotateForRun(runId);
    }

    const e = { ...this.envEnvelope("run.started"), payload: payload ?? {} };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    this.plugins.onEvent(e).catch(() => {});
  }

  finding(evt: FindingPayload) {
    if (!this.cfg.enabled || !this.currentRunId || !this.started || this.finished) return;

    const finding_id = makeFindingId(this.currentRunId, evt.rule_id, evt.file_hash, evt.locator);
    if (this.seenFindingIds.has(finding_id)) return; // dedup
    this.seenFindingIds.add(finding_id);

    const e = { ...this.envEnvelope("finding.reported"), payload: { ...evt, finding_id } };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    this.plugins.onEvent(e).catch(() => {});
  }

  finish(payload: RunFinishPayload) {
    if (!this.cfg.enabled || !this.currentRunId || !this.started || this.finished) return;

    this.finished = true;

    const e = { ...this.envEnvelope("run.finished"), payload };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    this.plugins.onEvent(e).finally(() => this.plugins.onFinish().catch(() => {}));
  }
}

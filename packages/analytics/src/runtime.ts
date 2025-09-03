import { JsonlWriter } from "@sentinel/analytics/src/writer.js";
import { EnvelopeV1 } from "@sentinel/analytics/src/schemas.js";
import { salted, makeFindingId } from "@sentinel/analytics/src/hash.js";
import { loadPlugins } from "@sentinel/analytics/src/plugin/loader.js";

type BaseCtx = {
  projectRemoteUrl?: string;
  commitSha?: string;
  branch?: string;
  provider?: string;
  profile?: string;
  env?: "ci"|"dev"|"local";
};

export class AnalyticsRuntime {
  private writer = new JsonlWriter();
  private pluginsReady = false;
  private plugins: Awaited<ReturnType<typeof loadPlugins>>["plugins"] = [];

  constructor(private baseCtx: BaseCtx) {}

  async initPlugins() {
    const { plugins } = await loadPlugins();
    this.plugins = plugins;
    // runtime hook
    await Promise.all(this.plugins.map(p => p.onEventWriteStart?.()));
    this.pluginsReady = true;
  }

  private envEnvelope(type: string) {
    const project_id = salted(this.baseCtx.projectRemoteUrl || "unknown");
    return {
      v: 1 as const,
      type,
      ts: Date.now(),
      run_id: this.currentRunId!,
      project_id,
      commit_sha: this.baseCtx.commitSha,
      branch: this.baseCtx.branch,
      provider: this.baseCtx.provider,
      profile: this.baseCtx.profile,
      env: this.baseCtx.env || (process.env.SENTINEL_ENV as any) || "dev",
    };
  }

  private currentRunId?: string;

  start(runId: string, payload?: Record<string, any>) {
    this.currentRunId = runId;
    const e = { ...this.envEnvelope("run.started"), payload };
    EnvelopeV1.parse(e); // базовая валидация
    this.writer.write(e);
    if (this.pluginsReady) this.plugins.forEach(p => p.onEventWrite?.(e).catch(()=>{}));
  }

  finding(args: {
    rule_id: string;
    severity: "info"|"minor"|"major"|"critical";
    file_hash: string;
    locator: string;
    signals?: Record<string, any>;
  }) {
    const finding_id = makeFindingId(this.currentRunId!, args.rule_id, args.file_hash, args.locator);
    const e = {
      ...this.envEnvelope("finding.reported"),
      payload: { ...args, finding_id },
    };
    EnvelopeV1.parse(e);
    this.writer.write(e);
    if (this.pluginsReady) this.plugins.forEach(p => p.onEventWrite?.(e).catch(()=>{}));
  }

  finish(payload: {
    duration_ms: number;
    findings_total: number;
    findings_by_severity: { critical: number; major: number; minor: number; info: number };
    impact_avg?: number;
    risk_level?: "low"|"medium"|"high"|"critical";
    tests_changed?: boolean;
  }) {
    const e = { ...this.envEnvelope("run.finished"), payload };
    EnvelopeV1.parse(e);
    this.writer.write(e);
    if (this.pluginsReady) {
      this.plugins.forEach(async (p) => {
        try { await p.onEventWrite?.(e); await p.onEventWriteFinish?.(); } catch {}
      });
    }
  }
}

import type { FindingPayload, RunFinishPayload } from "./types";
import { EnvelopeV1 } from "./schemas";
import { makeFindingId } from "./hash";
import type { AnalyticsClient } from "./types";
import type { Transport } from "./transport/file";
import type { PluginHost } from "./plugin/host";
import type { Hasher } from "./hash/hasher";
import type { ResolvedAnalyticsConfig } from "./types";
import type { BaseCtx } from "./plugin/types";

export class AnalyticsRuntime implements AnalyticsClient {
  private currentRunId?: string;
  private finished = false;
  private seenFindings = new Set<string>();
  private unsubs: Array<() => void> = [];

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

    this.currentRunId = runId;
    this.finished = false;
    this.seenFindings.clear();

    // переключаем файл на run (если режим byRun)
    this.transport.rotateForRun?.(runId);

    const e = { ...this.envEnvelope("run.started"), payload: payload ?? {} };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    void this.plugins.onEvent(e);

    // ── SAFE FINISH HOOKS (однократно на запуск)
    const safeFinish = () => {
      // если основное finish() не вызвалось — минимально закроем ран
      if (!this.finished && this.currentRunId) {
        try {
          const ev = {
            ...this.envEnvelope("run.finished"),
            payload: {
              duration_ms: 0,
              findings_total: 0,
              findings_by_severity: { critical: 0, major: 0, minor: 0, info: 0 },
            },
          };
          EnvelopeV1.parse(ev);
          this.transport.write(ev);
          this.finished = true;
        } catch {}
      }
      // закрываем транспорт (без await — мы в синхронном обработчике сигнала)
      try {
        void this.transport.close?.();
      } catch {}
      // снимаем подписки
      this.unsubs.forEach((u) => {
        try { u(); } catch {}
      });
      this.unsubs = [];
    };

    const onExit = () => safeFinish();
    const onSig = () => { safeFinish(); process.exit(130); };

    process.once("exit", onExit);
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
    process.once("uncaughtException", (err) => {
      console.error("[analytics] uncaughtException", err);
      safeFinish();
    });
    process.once("unhandledRejection", (err) => {
      console.error("[analytics] unhandledRejection", err);
      safeFinish();
    });

    this.unsubs = [
      () => process.off("exit", onExit),
      () => process.off("SIGINT", onSig),
      () => process.off("SIGTERM", onSig),
    ];
  }

  finding(evt: FindingPayload) {
    if (!this.cfg.enabled || !this.currentRunId || this.finished) return;

    const finding_id = makeFindingId(this.currentRunId, evt.rule_id, evt.file_hash, evt.locator);
    if (this.seenFindings.has(finding_id)) return; // дедуп в рамках run
    this.seenFindings.add(finding_id);

    const e = { ...this.envEnvelope("finding.reported"), payload: { ...evt, finding_id } };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    void this.plugins.onEvent(e);
  }

  // ⬇⬇⬇ ключевая правка: делаем async и ждём flush плагинов и транспорта
  async finish(payload: RunFinishPayload) {
    if (!this.cfg.enabled || !this.currentRunId || this.finished) return;

    const e = { ...this.envEnvelope("run.finished"), payload };
    EnvelopeV1.parse(e);
    this.transport.write(e);
    this.finished = true;

    try {
      await this.plugins.onEvent(e);
    } finally {
      await this.plugins.onFinish().catch(() => {});
      await this.transport.close?.();
    }

    // аккуратно снимаем подписки
    this.unsubs.forEach((u) => {
      try { u(); } catch {}
    });
    this.unsubs = [];
  }
}

export type PluginKind = "event" | "ingest" | "metric" | "report" | "sink";

export type SentinelPluginManifest = {
  name: string;
  version: string;
  api: "1.x";
  kind: PluginKind[];
  permissions?: Array<"fs" | "net" | "env">;
};

export type PluginContext = {
  log: (msg: string, ...a: any[]) => void;
  cfg: Record<string, any>;
  paths: { analyticsDir: string; dbPath?: string; repoRoot?: string };
  env: { privacy: "team" | "detailed" };
  db?: unknown; // присвоим в ingest/report
};

export interface SentinelPlugin {
  manifest: SentinelPluginManifest;

  // runtime (когда пишем события)
  onEventWriteStart?(): void | Promise<void>;
  onEventWrite?(event: any): void | Promise<void>;
  onEventWriteFinish?(): void | Promise<void>;

  // ingest (JSONL -> DB)
  onIngestInit?(): void | Promise<void>;
  onIngestEvent?(event: any): void | Promise<void>;
  onIngestFinish?(): void | Promise<void>;

  // metrics/views
  onMetrics?(): void | Promise<void>;

  // reports
  onReport?(emit: (outPath: string, content: string | Buffer) => void): void | Promise<void>;

  // sinks (внешние выгрузки)
  onSinkEvent?(event: any): void | Promise<void>;
}

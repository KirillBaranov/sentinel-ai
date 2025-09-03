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
  db?: unknown;
};

export interface SentinelPlugin {
  manifest: SentinelPluginManifest;
  onEventWriteStart?(): void | Promise<void>;
  onEventWrite?(event: any): void | Promise<void>;
  onEventWriteFinish?(): void | Promise<void>;
  onIngestInit?(): void | Promise<void>;
  onIngestEvent?(event: any): void | Promise<void>;
  onIngestFinish?(): void | Promise<void>;
  onMetrics?(): void | Promise<void>;
  onReport?(emit: (outPath: string, content: string | Buffer) => void): void | Promise<void>;
  onSinkEvent?(event: any): void | Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────────
export type BaseCtx = {
  projectRemoteUrl?: string;
  commitSha?: string;
  branch?: string;
  provider?: string;
  profile?: string;
  env?: "ci" | "dev" | "local";
};

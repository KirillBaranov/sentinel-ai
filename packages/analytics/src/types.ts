export type PrivacyMode = "team" | "detailed";
export type FileMode = "byDay" | "byRun";

export interface ResolvedAnalyticsConfig {
  enabled: boolean;
  outDir: string;              // абсолютный путь
  mode: FileMode;              // файловый режим ротации
  salt: string;
  privacy: PrivacyMode;
  plugins: string[];
  pluginConfig: Record<string, any>;
}

export type IngestStats = {
  fromDir: string
  dbPath: string
  since?: string
  filesScanned: number
  filesMatched: number        // учли по маске/фильтру
  eventsRead: number
  eventsValid: number         // прошли EnvelopeV1
  runsUpserted: number
  findingsUpserted: number
  duplicatesSkipped: number
  firstTs?: number            // минимальный ts из загруженного
  lastTs?: number             // максимальный ts
};

export type FindingPayload = {
  rule_id: string;
  severity: "info" | "minor" | "major" | "critical";
  file_hash: string;           // уже безопасный идентификатор
  locator: string;
  signals?: Record<string, any>;
};

export type RunFinishPayload = {
  duration_ms: number;
  findings_total: number;
  findings_by_severity: { critical: number; major: number; minor: number; info: number };
  impact_avg?: number;
  risk_level?: "low" | "medium" | "high" | "critical";
  tests_changed?: boolean;
};

export interface AnalyticsClient {
  diagnostics(): { enabled: boolean; mode: FileMode; outDir?: string; currentFile?: string; privacy: PrivacyMode };
  init(): Promise<void>;
  start(runId: string, payload?: Record<string, any>): void;
  finding(evt: FindingPayload): void;
  finish(payload: RunFinishPayload): Promise<void>;
}

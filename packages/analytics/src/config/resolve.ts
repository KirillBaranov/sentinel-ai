import path from "node:path";
import { ResolvedAnalyticsConfig } from "../types";

type RcLike = {
  analytics?: {
    enabled?: boolean;
    outDir?: string;
    salt?: string;
    privacy?: "team" | "detailed";
    plugins?: string[];
    pluginConfig?: Record<string, any>;
  };
};

type Overrides = Partial<Pick<
  ResolvedAnalyticsConfig,
  "enabled" | "outDir" | "mode" | "salt" | "privacy"
>>;

export function resolveAnalyticsConfig(input: {
  rc?: RcLike;
  overrides?: Overrides;
  repoRoot: string;
}): ResolvedAnalyticsConfig {
  const { rc, overrides, repoRoot } = input;

  const envEnabled = process.env.SENTINEL_ANALYTICS === "1" || process.env.SENTINEL_ANALYTICS === "true";
  const enabled = overrides?.enabled ?? rc?.analytics?.enabled ?? envEnabled ?? false;

  const outDirRaw =
    overrides?.outDir ??
    rc?.analytics?.outDir ??
    process.env.SENTINEL_ANALYTICS_DIR ??
    ".sentinel/analytics";
  const outDir = path.isAbsolute(outDirRaw) ? outDirRaw : path.join(repoRoot, outDirRaw);

  const modeEnv = (process.env.SENTINEL_ANALYTICS_FILE_MODE as "byRun" | "byDay") || undefined;
  const mode = overrides?.mode ?? modeEnv ?? "byDay";

  const salt =
    overrides?.salt ??
    rc?.analytics?.salt ??
    process.env.SENTINEL_ANALYTICS_SALT ??
    process.env.SENTINEL_SALT ??
    "sentinel";

  const privacyEnv = (process.env.SENTINEL_ANALYTICS_PRIVACY as "team" | "detailed") || undefined;
  const privacy = overrides?.privacy ?? rc?.analytics?.privacy ?? privacyEnv ?? "team";

  const plugins = rc?.analytics?.plugins ?? [];
  const pluginConfig = rc?.analytics?.pluginConfig ?? {};

  return { enabled, outDir, mode, salt, privacy, plugins, pluginConfig };
}

import { FileTransport } from "./transport/file";
import { DefaultPluginHost } from "./plugin/host";
import { Hasher } from "./hash/hasher";
import { AnalyticsRuntime } from "./runtime";
import type { ResolvedAnalyticsConfig, AnalyticsClient } from "./types";
import type { BaseCtx } from "./plugin/types";

export function createAnalyticsClient(ctx: BaseCtx, cfg: ResolvedAnalyticsConfig): AnalyticsClient {
  if (!cfg.enabled) {
    // no-op клиент
    return {
      diagnostics: () => ({ enabled: false, mode: cfg.mode, privacy: cfg.privacy }),
      init: async () => {},
      start: () => {},
      finding: () => {},
      finish: () => {},
    };
  }
  const transport = new FileTransport(cfg);
  const plugins = new DefaultPluginHost();
  const hasher = new Hasher(cfg.salt, cfg.privacy);
  return new AnalyticsRuntime(ctx, cfg, transport, plugins, hasher);
}

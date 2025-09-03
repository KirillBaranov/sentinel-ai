import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginContext, SentinelPlugin } from "./types.js";

type ConfigFile = {
  plugins?: string[];
  pluginConfig?: Record<string, any>;
};

function resolveModule(ref: string, cwd = process.cwd()) {
  if (ref.startsWith(".") || ref.startsWith("/")) {
    const abs = path.isAbsolute(ref) ? ref : path.join(cwd, ref);
    return pathToFileURL(abs).href;
  }
  return ref; // node_modules
}

export async function loadPlugins(
  cfgPath = ".sentinel/analytics.config.json",
  baseCtx: Omit<PluginContext, "cfg"> = {
    log: (...a) => console.log("[analytics:plugin]", ...a),
    paths: { analyticsDir: process.env.SENTINEL_ANALYTICS_DIR || ".sentinel/analytics" },
    env: { privacy: "team" },
  }
): Promise<{ plugins: SentinelPlugin[]; getCtx: (ref: string) => PluginContext }> {
  let cfg: ConfigFile = {};
  try { cfg = JSON.parse(await fs.readFile(cfgPath, "utf8")); } catch {}

  const plugins: SentinelPlugin[] = [];
  for (const ref of cfg.plugins || []) {
    const mod = await import(resolveModule(ref));
    const plugin: SentinelPlugin = (mod.default ?? mod.plugin ?? mod) as any;
    if (!plugin?.manifest || !/^1\./.test(plugin.manifest.api)) {
      baseCtx.log(`skip plugin ${ref}: invalid manifest/api`);
      continue;
    }
    // оборачиваем, чтобы автоматически прокидывать ctx в методы через .bind
    const ctx: PluginContext = { ...baseCtx, cfg: (cfg.pluginConfig || {})[ref] || {} };
    const wrap: any = {};
    for (const key of Object.keys(plugin)) {
      const v = (plugin as any)[key];
      wrap[key] = typeof v === "function" ? v.bind(plugin, ctx) : v;
    }
    plugins.push(wrap as SentinelPlugin);
  }
  const getCtx = (ref: string) => ({ ...baseCtx, cfg: (cfg.pluginConfig || {})[ref] || {} });
  return { plugins, getCtx };
}

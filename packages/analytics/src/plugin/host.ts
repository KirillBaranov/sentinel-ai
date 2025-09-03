import { loadPlugins } from "./loader";
import { SentinelPlugin } from "./types";

export interface PluginHost {
  init(): Promise<void>;
  onEvent(e: any): Promise<void>;
  onFinish(): Promise<void>;
}

export class DefaultPluginHost implements PluginHost {
  private plugins: SentinelPlugin[] = [];
  private ready = false;

  async init() {
    const { plugins } = await loadPlugins();
    this.plugins = plugins;
    await Promise.all(this.plugins.map(p => Promise.resolve(p.onEventWriteStart?.())));
    this.ready = true;
  }

  async onEvent(e: any) {
    if (!this.ready) return;
    await Promise.all([
      ...this.plugins.map(p => Promise.resolve(p.onEventWrite?.(e))),
      ...this.plugins.map(p => Promise.resolve(p.onSinkEvent?.(e))),
    ]);
  }

  async onFinish() {
    if (!this.ready) return;
    await Promise.all(this.plugins.map(p => Promise.resolve(p.onEventWriteFinish?.())));
  }
}

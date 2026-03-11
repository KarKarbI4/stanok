// ─── Plugin Registry ────────────────────────────────────────────────────────
// Resolves settings, binds plugins, provides services, exposes plugin commands.

import type { AuthResolver, Plugin, PluginCommand, PluginDef, StatusColors, TaskInfo } from "./plugin";
import { bindPlugin } from "./plugin";
import type { IssueTracker, CodeHost } from "./services";

interface BoundPlugin {
  def: PluginDef;
  settings: Record<string, any>;
  plugin: Plugin;
}

export class PluginRegistry {
  private bound: BoundPlugin[] = [];
  private services = new Map<string, any>();
  private auth: AuthResolver;

  constructor(
    defs: PluginDef[],
    projectSettings: Record<string, any>,
    personalSettings: Record<string, any>,
    auth: AuthResolver,
    remoteUrl: string | null = null,
  ) {
    this.auth = auth;

    for (const def of defs) {
      // Merge settings: plugin defaults ← project ← personal
      const resolved = { ...def.settings };
      for (const key of Object.keys(def.settings)) {
        if (key in projectSettings) resolved[key] = projectSettings[key];
        if (key in personalSettings) resolved[key] = personalSettings[key];
      }

      const plugin = bindPlugin(def, resolved);
      this.bound.push({ def, settings: resolved, plugin });

      // Register provided services
      if (def.provides) {
        for (const [name, factory] of Object.entries(def.provides)) {
          const service = factory(resolved, auth, remoteUrl);
          if (service != null) {
            this.services.set(name, service);
          }
        }
      }
    }
  }

  get<T>(name: string): T | null {
    return this.services.get(name) ?? null;
  }

  get issueTracker(): IssueTracker | null {
    return this.get("issueTracker");
  }

  get codeHost(): CodeHost | null {
    return this.get("codeHost");
  }

  allPlugins(): Plugin[] {
    return this.bound.map((b) => b.plugin);
  }

  /** All commands registered by plugins */
  commands(): Record<string, PluginCommand> {
    const cmds: Record<string, PluginCommand> = {};
    for (const { def, settings } of this.bound) {
      if (!def.commands) continue;
      for (const [name, factory] of Object.entries(def.commands)) {
        const cmd = factory(settings, this.auth);
        if (cmd) cmds[name] = cmd;
      }
    }
    return cmds;
  }

  /** Enrich tasks with plugin-provided data (summary, status, etc.) */
  async enrich(tasks: TaskInfo[]): Promise<void> {
    for (const { def, settings } of this.bound) {
      if (def.enrich) {
        try {
          await def.enrich(tasks, settings, this.auth);
        } catch {}
      }
    }
  }

  /** Merged status colors from all plugins (first one wins) */
  statusColors(): StatusColors | null {
    for (const { def, settings } of this.bound) {
      if (def.statusColors) {
        const colors = def.statusColors(settings);
        if (colors) return colors;
      }
    }
    return null;
  }

  /** Command metadata for cache (desc, usage, plugin name) */
  commandMeta(): Record<string, { desc: string; usage?: string; plugin: string }> {
    const meta: Record<string, { desc: string; usage?: string; plugin: string }> = {};
    for (const { def, settings } of this.bound) {
      if (!def.commands) continue;
      for (const [name, factory] of Object.entries(def.commands)) {
        const cmd = factory(settings, this.auth);
        if (cmd) meta[name] = { desc: cmd.desc, usage: cmd.usage, plugin: def.name };
      }
    }
    return meta;
  }
}

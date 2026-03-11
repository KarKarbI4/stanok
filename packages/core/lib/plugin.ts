// ─── Plugin system ──────────────────────────────────────────────────────────

export type AuthResolver = (url: string) => { token: string } | null;

export interface PluginContext {
  taskId: string;
  branch: string;
  env: Record<string, string>;
  repo: string;
  wtPath: string;
}

export interface PluginCommand {
  desc: string;
  usage?: string;
  run(args: string[], cwd?: string): Promise<void>;
}

export interface StatusColors {
  open: string[];
  inProgress: string[];
  done: string[];
}

export interface TaskInfo {
  task_id: string;
  env?: Record<string, string>;
  branch: string;
  path: string;
  repo: string;
  created_at: string;
  [key: string]: any;
}

export interface Plugin {
  name: string;
  pruneIgnore?: string[];
  postCreate?(ctx: PluginContext): Promise<void> | void;
  preStart?(ctx: PluginContext): Promise<void> | void;
  preStop?(ctx: PluginContext): Promise<void> | void;
  postRemove?(ctx: PluginContext): Promise<void> | void;
}

export interface PluginDef<S extends Record<string, any> = Record<string, any>> {
  name: string;
  settings: S;
  pruneIgnore?: string[];
  provides?: {
    [serviceName: string]: (settings: S, auth: AuthResolver, remoteUrl: string | null) => any | null;
  };
  commands?: Record<string, (settings: S, auth: AuthResolver) => PluginCommand | null>;
  enrich?(tasks: TaskInfo[], settings: S, auth: AuthResolver): Promise<void>;
  statusColors?(settings: S): StatusColors | null;
  // Lifecycle hooks (worktree management)
  postCreate?(ctx: PluginContext, settings: S): Promise<void> | void;
  preStart?(ctx: PluginContext, settings: S): Promise<void> | void;
  preStop?(ctx: PluginContext, settings: S): Promise<void> | void;
  postRemove?(ctx: PluginContext, settings: S): Promise<void> | void;
}

export function definePlugin<S extends Record<string, any>>(def: PluginDef<S>): PluginDef<S> {
  return def;
}

/** Bind PluginDef + resolved settings → Plugin (ready to execute hooks) */
export function bindPlugin<S extends Record<string, any>>(def: PluginDef<S>, settings: S): Plugin {
  return {
    name: def.name,
    pruneIgnore: def.pruneIgnore,
    postCreate: def.postCreate ? (ctx) => def.postCreate!(ctx, settings) : undefined,
    preStart: def.preStart ? (ctx) => def.preStart!(ctx, settings) : undefined,
    preStop: def.preStop ? (ctx) => def.preStop!(ctx, settings) : undefined,
    postRemove: def.postRemove ? (ctx) => def.postRemove!(ctx, settings) : undefined,
  };
}

/** Declare which plugins to load in ~/.stanok/plugins.ts */
export function definePlugins(defs: PluginDef[]): PluginDef[] {
  return defs;
}

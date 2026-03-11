import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import { $ } from "bun";
import {
  findProjectRoot,
  loadWorkbenchJson,
  resolveWorkbenchConfig,
  type WorkbenchProjectConfig,
} from "./project";
import type { PluginDef, AuthResolver } from "./plugin";
import { PluginRegistry } from "./registry";
import { getAuth } from "./auth";
import type { Config, State, TaskMeta, RepoConfig } from "./types";

// Re-export for convenience
export { findProjectRoot, loadWorkbenchJson, resolveWorkbenchConfig };
export type { WorkbenchProjectConfig };
export type { Plugin, PluginContext, PluginDef, AuthResolver } from "./plugin";
export { definePlugin, bindPlugin } from "./plugin";
export { PluginRegistry } from "./registry";
export { readAuth, getAuth, setAuth, promptToken, requireAuth, withAuthRetry } from "./auth";
export type { ServiceAuth, AuthConfig } from "./auth";
export type { Config, State, TaskMeta, RepoConfig } from "./types";

// ─── Paths ──────────────────────────────────────────────────────────────────

export function skHome(): string {
  return join(process.env.HOME!, ".stanok");
}

/** @deprecated No longer needed — plugins are installed via `bun add` in ~/.stanok/ */
export function ensureWorkbenchLink(): void {}
function configPath(): string {
  return join(skHome(), "settings.json");
}
function statePath(): string {
  return join(skHome(), "state.json");
}

// ─── Ensure dirs ────────────────────────────────────────────────────────────

function ensureDirs() {
  mkdirSync(skHome(), { recursive: true });
}

// ─── Config ─────────────────────────────────────────────────────────────────

export async function readConfigAsync(): Promise<Config> {
  ensureDirs();
  if (!existsSync(configPath())) return {};
  try {
    const text = await Bun.file(configPath()).text();
    return JSON.parse(text) as Config;
  } catch {
    return {};
  }
}

export async function writeConfig(patch: Partial<Config>): Promise<void> {
  ensureDirs();
  const current = await readConfigAsync();
  const merged = { ...current, ...patch };
  await Bun.write(configPath(), JSON.stringify(merged, null, 2) + "\n");
}

// ─── State ──────────────────────────────────────────────────────────────────

export async function readStateAsync(): Promise<State> {
  ensureDirs();
  if (!existsSync(statePath())) {
    // Migrate from config.json if needed
    if (existsSync(configPath())) {
      try {
        const text = await Bun.file(configPath()).text();
        const raw = JSON.parse(text);
        if (raw.repos || raw.repo) {
          const repos = raw.repos || (raw.repo ? [raw.repo] : []);
          return { repos, repo_env: raw.repo_env, last_stand: raw.last_stand };
        }
      } catch {}
    }
    return { repos: [] };
  }
  try {
    const text = await Bun.file(statePath()).text();
    const raw = JSON.parse(text);
    if (!raw.repos) raw.repos = [];
    return raw as State;
  } catch {
    return { repos: [] };
  }
}

export async function writeState(patch: Partial<State>): Promise<void> {
  ensureDirs();
  const current = await readStateAsync();
  const merged = { ...current, ...patch };
  if (patch.repo_env) {
    merged.repo_env = { ...current.repo_env, ...patch.repo_env };
  }
  await Bun.write(statePath(), JSON.stringify(merged, null, 2) + "\n");
}

// ─── Env file helpers ────────────────────────────────────────────────────────

export function readEnvFile(wtPath: string, envFile: string = ".env.development.local"): Record<string, string> {
  const p = join(wtPath, envFile);
  if (!existsSync(p)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

// ─── Plugin registry loading ────────────────────────────────────────────────

/** Load plugin registry: plugins from ~/.stanok/plugins.ts, with services resolved. */
export async function loadPluginRegistry(
  wb: WorkbenchProjectConfig,
  config: Config,
  repoPath?: string,
): Promise<PluginRegistry> {
  const pluginsFile = join(skHome(), "plugins.ts");
  let allDefs: PluginDef[] = [];

  if (existsSync(pluginsFile)) {
    ensureWorkbenchLink();
    try {
      const mod = await import(pluginsFile);
      const exported = mod.plugins;
      if (Array.isArray(exported)) allDefs = exported;
    } catch (e: any) {
      console.error(`plugins.ts failed to load: ${e.message}`);
    }
  }

  const projectSettings = extractDotKeys(wb);
  const personalSettings = extractDotKeys(config);

  // Resolve git remote URL for plugin auto-detection
  let remoteUrl: string | null = null;
  if (repoPath) {
    const { getRemoteUrl } = await import("./utils/git");
    remoteUrl = await getRemoteUrl(repoPath);
  }

  const auth: AuthResolver = (url) => getAuth(url);

  return new PluginRegistry(allDefs, projectSettings, personalSettings, auth, remoteUrl);
}

/** Convenience: load registry from repo path. Returns registry + tracker shortcut. */
export async function loadTracker(repo: string): Promise<{ registry: PluginRegistry; tracker: import("./services").IssueTracker | null }> {
  const rc = loadRepoConfig(repo);
  const config = await readConfigAsync();
  const registry = await loadPluginRegistry(rc.workbench, config, repo);
  return { registry, tracker: registry.issueTracker };
}

/** Extract dot-separated keys from an object */
export function extractDotKeys(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.includes(".") && !k.startsWith("$")) result[k] = v;
  }
  return result;
}

// ─── Worktree-derived task registry ──────────────────────────────────────────

interface WorktreeEntry {
  path: string;
  branch: string; // full ref, e.g. refs/heads/feature/PROJ-123
}

export async function listWorktrees(repo: string): Promise<WorktreeEntry[]> {
  const result = await $`git -C ${repo} worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) return [];

  const entries: WorktreeEntry[] = [];
  const wtBase = resolve(repo, "..", `${basename(repo)}__worktrees`);

  for (const block of result.text().split("\n\n")) {
    let path = "";
    let branch = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length);
    }
    if (!path || !path.startsWith(wtBase) || !branch) continue;
    entries.push({ path, branch });
  }
  return entries;
}

export async function listTasks(): Promise<TaskMeta[]> {
  const state = await readStateAsync();
  const tasks: TaskMeta[] = [];

  for (const repo of state.repos) {
    if (!existsSync(repo)) continue;
    const rc = loadRepoConfig(repo);
    const worktrees = await listWorktrees(repo);

    for (const wt of worktrees) {
      const shortBranch = wt.branch.replace("refs/heads/", "");
      const taskId = taskIdUpper(basename(wt.path));
      let created_at = "";
      try {
        created_at = statSync(wt.path).birthtime.toISOString();
      } catch {}
      tasks.push({
        task_id: taskId,
        branch: shortBranch,
        path: wt.path,
        repo,
        env: readEnvFile(wt.path),
        created_at,
      });
    }
  }
  return tasks;
}

export async function readTask(id: string): Promise<TaskMeta | null> {
  const state = await readStateAsync();
  id = taskIdUpper(id);

  for (const repo of state.repos) {
    if (!existsSync(repo)) continue;
    const rc = loadRepoConfig(repo);
    const wtPath = worktreePath(repo, id);
    if (!existsSync(wtPath)) continue;

    const branch = branchName(id, rc.workbench.branchTemplate);
    let created_at = "";
    try {
      created_at = statSync(wtPath).birthtime.toISOString();
    } catch {}
    return {
      task_id: id,
      branch,
      path: wtPath,
      repo,
      env: readEnvFile(wtPath),
      created_at,
    };
  }
  return null;
}

// ─── Repo detection ─────────────────────────────────────────────────────────

/** Find the git toplevel for cwd. If inside a worktree, resolves to the main repo. */
export async function detectRepo(cwd: string): Promise<string | null> {
  const dir = resolve(cwd);

  // 1. If inside a git worktree (.git is a file pointing to main repo)
  const gitPath = join(dir, ".git");
  if (existsSync(gitPath)) {
    try {
      const content = readFileSync(gitPath, "utf-8").trim();
      if (content.startsWith("gitdir:")) {
        const gitDir = content.slice("gitdir:".length).trim();
        // gitdir points to .git/worktrees/<name> → ../../ is the main .git dir
        const mainGit = resolve(dir, gitDir, "../..");
        const mainRepo = resolve(mainGit, "..");
        if (existsSync(join(mainRepo, ".git"))) return mainRepo;
      }
    } catch {}
  }

  // 2. Walk up to find git toplevel
  const result = await $`git -C ${dir} rev-parse --show-toplevel`.quiet().nothrow();
  if (result.exitCode === 0) {
    return result.text().trim();
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function taskIdUpper(id: string): string {
  return id.toUpperCase();
}

export function taskIdLower(id: string): string {
  return id.toLowerCase();
}

export function worktreePath(repo: string, taskId: string): string {
  const base = basename(repo);
  return resolve(repo, "..", `${base}__worktrees`, taskIdLower(taskId));
}

export function branchName(taskId: string, template: string = "{task}"): string {
  return template.replace("{task}", taskIdUpper(taskId));
}

// ─── Repo config ─────────────────────────────────────────────────────────

export function loadRepoConfig(repoPath: string): RepoConfig {
  const root = findProjectRoot(repoPath);
  const wbJson = root ? loadWorkbenchJson(root) : {};
  const workbench = resolveWorkbenchConfig(wbJson, repoPath);
  return { workbench, repoPath };
}

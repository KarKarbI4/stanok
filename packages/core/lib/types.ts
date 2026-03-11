// ─── Shared types ───────────────────────────────────────────────────────────

export interface TaskMeta {
  task_id: string;
  env?: Record<string, string>;
  branch: string;
  path: string;
  repo: string;
  created_at: string;
  summary?: string;
  status?: string;
}

export interface TrackerIssue {
  key: string;
  summary: string;
  status: string;
  has_workbench: boolean;
}

export interface StatusConfig {
  open?: string[];
  inProgress?: string[];
  done?: string[];
}

export interface Config {
  [key: `${string}.${string}`]: any;
}

export interface State {
  repos: string[];
  repo_env?: Record<string, Record<string, string>>; // repo path → env vars
  last_stand?: string;
}

export interface RepoConfig {
  workbench: import("./project").WorkbenchProjectConfig;
  repoPath: string;
}

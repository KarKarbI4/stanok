import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve, basename } from "path";

// ─── .stanok/settings.json schema ──────────────────────────────────────────

const STANOK_DIR = ".stanok";
const WORKBENCH_CONFIG_NAME = "settings.json";
const WORKBENCH_LOCAL_CONFIG_NAME = "settings.local.json";

export interface SentryEnv {
  env: string;
  url: string;
  org: string;
  project: string;
}

export interface WorkbenchProjectConfig {
  baseBranch: string;
  branchTemplate: string;
  proxyPort: number;
  mergeDetection: string;
  envFile: string;
  packageManager?: string;
  pruneIgnore?: string[];
  sentry?: SentryEnv[];
  [key: `${string}.${string}`]: any;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULTS: WorkbenchProjectConfig = {
  baseBranch: "master",
  branchTemplate: "{task}",
  proxyPort: 1355,
  mergeDetection: "Pull request",
  envFile: ".env.development.local",
};

// ─── Loaders ───────────────────────────────────────────────────────────────

export function findProjectRoot(startDir?: string): string | null {
  let dir = resolve(startDir || process.cwd());
  while (true) {
    const stanokDir = join(dir, STANOK_DIR);
    if (existsSync(join(stanokDir, WORKBENCH_CONFIG_NAME)) || existsSync(join(stanokDir, WORKBENCH_LOCAL_CONFIG_NAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadWorkbenchJson(root: string): Partial<WorkbenchProjectConfig> {
  let base: Record<string, any> = {};
  const stanokDir = join(root, STANOK_DIR);
  const filePath = join(stanokDir, WORKBENCH_CONFIG_NAME);
  if (existsSync(filePath)) {
    try { base = JSON.parse(readFileSync(filePath, "utf-8")); } catch {}
  }
  const localPath = join(stanokDir, WORKBENCH_LOCAL_CONFIG_NAME);
  if (existsSync(localPath)) {
    try {
      const local = JSON.parse(readFileSync(localPath, "utf-8"));
      base = { ...base, ...local };
    } catch {}
  }
  return base;
}

export function resolveWorkbenchConfig(
  wbJson: Partial<WorkbenchProjectConfig>,
  repoPath?: string,
): WorkbenchProjectConfig {
  const wb = { ...DEFAULTS, ...wbJson };
  if (wb.packageManager === "auto" && repoPath) {
    wb.packageManager = detectPackageManager(repoPath);
  }
  return wb;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function detectPackageManager(repoPath: string): string {
  if (existsSync(join(repoPath, "bun.lockb")) || existsSync(join(repoPath, "bun.lock")))
    return "bun";
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}

export function projectSlug(projectRoot: string): string {
  return basename(projectRoot);
}

export function parseBitbucketRepo(repo: string): { project: string; repo: string } | null {
  const match = repo.match(/^projects\/([^/]+)\/repos\/(.+)$/);
  if (!match) return null;
  return { project: match[1], repo: match[2] };
}

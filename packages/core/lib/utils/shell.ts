import { $ } from "bun";
import { mkdirSync, copyFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  readStateAsync,
  detectRepo,
} from "../config";
import { WbError } from "./error";

export function info(msg: string) {
  console.log(`→ ${msg}`);
}

export async function requireRepo(cwd?: string): Promise<string> {
  const repo = await detectRepo(cwd || process.cwd());
  if (!repo) {
    throw new WbError("Not inside a git repository");
  }
  return repo;
}

export function tokenHint(label: string, url: string): string {
  const base = url.replace(/\/+$/, "");
  if (label === "Bitbucket") {
    return [
      `  1. Открой ${base}/plugins/servlet/access-tokens/`,
      `  2. Create token → Name: "stanok"`,
      `  3. Project permissions: Project read`,
      `  4. Repository permissions: Repository read`,
      `  5. Expiry: do not expire`,
      `  6. Create`,
    ].join("\n");
  }
  if (label === "Jira") {
    return [
      `  1. Открой ${base}/secure/ViewProfile.jspa`,
      `  2. Personal Access Tokens`,
      `  3. Create token → Name: "stanok"`,
      `  4. Expiry date: убрать галочку "Automatic expiry"`,
      `  5. Create`,
    ].join("\n");
  }
  if (label === "Bamboo") {
    return [
      `  1. Открой ${base}/profile/userAccessTokens.action`,
      `  2. Create token → Name: "stanok"`,
      `  3. Permissions: read permissions`,
      `  4. Expiry: do not expire`,
      `  5. Create`,
    ].join("\n");
  }
  return "";
}

export function hookEnv(
  taskId: string,
  branch: string,
  env: Record<string, string>,
  repo: string,
  wtPath: string,
): Record<string, string> {
  return {
    TASK_ID: taskId,
    BRANCH: branch,
    ...env,
    REPO_PATH: repo,
    WORKTREE_PATH: wtPath,
  };
}

export async function runHooks(
  hookName: string,
  hooks: string[] | undefined,
  env: Record<string, string>,
  cwd: string,
) {
  if (!hooks?.length) return;
  for (const cmd of hooks) {
    info(`Running ${hookName}: ${cmd}`);
    try {
      await $`sh -c ${cmd}`.env({ ...process.env, ...env }).cwd(cwd).quiet();
    } catch (e: any) {
      console.error(`  Hook "${cmd}" failed: ${e.message}`);
    }
  }
}

export async function copyFilesFromRepo(
  repo: string,
  wtPath: string,
  copyConfig: { include: string[]; exclude?: string[] },
): Promise<string[]> {
  const copied: string[] = [];
  for (const pattern of copyConfig.include) {
    const glob = new Bun.Glob(pattern);
    for await (const match of glob.scan({ cwd: repo, dot: true })) {
      if (copyConfig.exclude?.some((ex) => new Bun.Glob(ex).match(match))) {
        continue;
      }
      const src = join(repo, match);
      const dst = join(wtPath, match);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      copied.push(match);
    }
  }
  return copied;
}

export function writeEnvFile(
  wtPath: string,
  env: Record<string, string>,
  envFile: string = ".env.development.local",
): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(wtPath, envFile), lines.join("\n") + "\n");
}

export async function openUrl(url: string): Promise<void> {
  if (process.env.SK_TEST) return;
  await $`open ${url}`.quiet().nothrow();
}

export function formatEnv(env: Record<string, string>): string {
  const entries = Object.entries(env);
  if (!entries.length) return "-";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

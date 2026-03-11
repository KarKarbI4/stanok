import { $ } from "bun";
import { existsSync } from "fs";
import {
  readEnvFile,
  taskIdUpper,
  taskIdLower,
  worktreePath,
  branchName,
  loadRepoConfig,
  loadTracker,
  type PluginContext,
} from "@stanok/core/config";
import { WbError, info, requireRepo, hookEnv, runHooks } from "@stanok/core/utils";

export async function cmdMv(args: string[], cwd?: string) {
  if (args.length !== 2) throw new WbError("Usage: stanok mv <OLD_ID> <NEW_ID>");

  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;
  const oldId = taskIdUpper(args[0]);
  const newId = taskIdUpper(args[1]);

  const oldPath = worktreePath(repo, oldId);
  if (!existsSync(oldPath)) throw new WbError(`Worktree for ${oldId} not found at ${oldPath}`);

  const newPath = worktreePath(repo, newId);
  if (existsSync(newPath)) throw new WbError(`Task ${newId} already exists at ${newPath}`);

  const oldBranch = branchName(oldId, wb.branchTemplate);
  const newBranch = branchName(newId, wb.branchTemplate);

  // 1. Fire preStop hooks to kill server
  const { registry } = await loadTracker(repo);
  const allPlugins = registry.allPlugins();
  const oldEnv = readEnvFile(oldPath, wb.envFile);
  const oldCtx: PluginContext = { taskId: oldId, branch: oldBranch, env: oldEnv, repo, wtPath: oldPath };
  for (const p of allPlugins) await p.preStop?.(oldCtx);

  // 2. Rename branch
  info(`Renaming branch ${oldBranch} → ${newBranch}`);
  await $`git -C ${oldPath} branch -m ${oldBranch} ${newBranch}`;

  // 3. Move worktree
  info(`Moving worktree → ${newPath}`);
  const moveResult = await $`git -C ${repo} worktree move ${oldPath} ${newPath}`.quiet().nothrow();
  if (moveResult.exitCode !== 0) {
    await $`mv ${oldPath} ${newPath}`;
  }

  // 4. Run postCreate hooks + plugins to regenerate symlinks, etc.
  const env = readEnvFile(newPath, wb.envFile);
  const hEnv = hookEnv(newId, newBranch, env, repo, newPath);
  const pluginCtx: PluginContext = { taskId: newId, branch: newBranch, env, repo, wtPath: newPath };
  await runHooks("postCreate", wb["hooks.postCreate"], hEnv, newPath);
  for (const p of allPlugins) await p.postCreate?.(pluginCtx);

  info(`Renamed ${oldId} → ${newId}`);
}

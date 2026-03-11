import { existsSync } from "fs";
import {
  readConfigAsync,
  readEnvFile,
  taskIdUpper,
  worktreePath,
  branchName,
  loadRepoConfig,
  loadTracker,
  type PluginContext,
} from "@stanok/core/config";
import {
  WbError,
  info,
  requireRepo,
  hookEnv,
  runHooks,
} from "@stanok/core/utils";

export async function cmdStop(args: string[], cwd?: string) {
  let taskId = "";
  let remove = false;

  for (const arg of args) {
    if (arg === "--remove") remove = true;
    else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    else if (!taskId) taskId = arg;
    else throw new WbError(`Unexpected argument: ${arg}`);
  }

  if (!taskId) throw new WbError("Usage: stanok stop <TASK_ID> [--remove]");

  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;
  taskId = taskIdUpper(taskId);
  const wtPath = worktreePath(repo, taskId);
  const branch = branchName(taskId, wb.branchTemplate);

  if (!existsSync(wtPath)) throw new WbError(`Worktree for ${taskId} not found at ${wtPath}`);

  // Fire preStop hooks on all plugins
  const config = await readConfigAsync();
  const env = readEnvFile(wtPath, wb.envFile);
  const { registry } = await loadTracker(repo);
  const allPlugins = registry.allPlugins();
  const pluginCtx: PluginContext = { taskId, branch, env, repo, wtPath };
  for (const p of allPlugins) await p.preStop?.(pluginCtx);

  if (remove) {
    // postRemove hooks + plugins (before deletion)
    const hEnv = hookEnv(taskId, branch, env, repo, wtPath);
    await runHooks("postRemove", wb["hooks.postRemove"], hEnv, wtPath);
    for (const p of allPlugins) await p.postRemove?.(pluginCtx);
    await runHooks("postRemove (personal)", config["hooks.postRemove"], hEnv, wtPath);

    info(`Removing worktree at ${wtPath}`);
    const { $ } = await import("bun");
    const removeResult = await $`git -C ${repo} worktree remove ${wtPath} --force`.quiet().nothrow();
    if (removeResult.exitCode !== 0) {
      await $`rm -rf ${wtPath}`.quiet().nothrow();
    }
    info(`Task ${taskId} fully removed`);
  } else {
    info(`Task ${taskId} stopped (worktree preserved at ${wtPath})`);
  }
}

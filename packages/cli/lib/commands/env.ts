import { existsSync } from "fs";
import {
  readEnvFile,
  readConfigAsync,
  writeState,
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
  currentBranch,
  taskIdFromBranch,
  writeEnvFile,
  formatEnv,
} from "@stanok/core/utils";

export async function cmdEnv(args: string[], cwd?: string) {
  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;

  let taskId: string;
  try {
    const branch = await currentBranch(cwd);
    const detected = taskIdFromBranch(branch, wb.branchTemplate);
    if (!detected) throw new WbError(`Cannot detect task ID from branch '${branch}'. Run from a worktree.`);
    taskId = taskIdUpper(detected);
  } catch (e) {
    if (e instanceof WbError) throw e;
    throw new WbError("Not in a git repository. Run from a worktree.");
  }
  const wtPath = worktreePath(repo, taskId);
  if (!existsSync(wtPath)) throw new WbError(`Worktree for ${taskId} not found at ${wtPath}`);

  // Parse KEY=VALUE args
  const updates: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    const eq = arg.indexOf("=");
    if (eq > 0) {
      updates[arg.slice(0, eq)] = arg.slice(eq + 1);
    } else {
      throw new WbError(`Invalid format: ${arg}. Use KEY=VALUE`);
    }
  }

  if (!Object.keys(updates).length) {
    // Show current env
    const env = readEnvFile(wtPath, wb.envFile);
    if (Object.keys(env).length) {
      for (const [k, v] of Object.entries(env)) {
        console.log(`${k}=${v}`);
      }
    } else {
      console.log("(no env vars set)");
    }
    return;
  }

  // Update env
  const current = readEnvFile(wtPath, wb.envFile);
  const env = { ...current, ...updates };
  writeEnvFile(wtPath, env, wb.envFile);

  await writeState({ repo_env: { [repo]: env } });

  // Fire preStop hooks to restart server with new env
  const branch = branchName(taskId, wb.branchTemplate);
  const { registry } = await loadTracker(repo);
  const allPlugins = registry.allPlugins();
  const pluginCtx: PluginContext = { taskId, branch, env, repo, wtPath };
  for (const p of allPlugins) await p.preStop?.(pluginCtx);

  info(`Env for ${taskId}: ${formatEnv(env)}`);
}

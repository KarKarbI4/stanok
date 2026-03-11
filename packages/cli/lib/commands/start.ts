import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import {
  readConfigAsync,
  readStateAsync,
  writeState,
  readEnvFile,
  taskIdUpper,
  taskIdLower,
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
  copyFilesFromRepo,
  writeEnvFile,
  formatEnv,
} from "@stanok/core/utils";

export async function cmdStart(args: string[], cwd?: string) {
  let taskId = "";
  const envArgs: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--env=")) {
      const kv = arg.slice("--env=".length);
      const eq = kv.indexOf("=");
      if (eq > 0) envArgs[kv.slice(0, eq)] = kv.slice(eq + 1);
      else throw new WbError(`Invalid --env format: ${arg}. Use --env=KEY=VALUE`);
    } else if (arg === "--env") {
      const next = args[++i];
      if (!next) throw new WbError("--env requires KEY=VALUE argument");
      const eq = next.indexOf("=");
      if (eq > 0) envArgs[next.slice(0, eq)] = next.slice(eq + 1);
      else throw new WbError(`Invalid env format: ${next}. Use KEY=VALUE`);
    } else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    else if (!taskId) taskId = arg;
    else throw new WbError(`Unexpected argument: ${arg}`);
  }

  if (!taskId) throw new WbError("Usage: stanok start <TASK_ID> [--env KEY=VALUE] [options]");

  const config = await readConfigAsync();
  const state = await readStateAsync();
  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;
  taskId = taskIdUpper(taskId);
  const branch = branchName(taskId, wb.branchTemplate);
  const wtPath = worktreePath(repo, taskId);

  // Load plugins
  const { registry } = await loadTracker(repo);

  // 1. Create worktree
  const isNewWorktree = !existsSync(wtPath);
  if (!isNewWorktree) {
    info(`Worktree already exists at ${wtPath}`);
  } else {
    info(`Creating worktree at ${wtPath} (branch: ${branch})`);
    await $`git -C ${repo} fetch origin ${wb.baseBranch} --quiet`.quiet().nothrow();

    const branchExists =
      (await $`git -C ${repo} show-ref --verify --quiet refs/heads/${branch}`.quiet().nothrow()).exitCode === 0;

    if (branchExists) {
      await $`git -C ${repo} worktree add ${wtPath} ${branch}`;
    } else {
      await $`git -C ${repo} worktree add ${wtPath} -b ${branch} origin/${wb.baseBranch}`;
      await $`git -C ${wtPath} branch --unset-upstream`.quiet().nothrow();
    }
  }

  // 2. Copy files from repo (before install so .npmrc etc. are in place)
  const copyInclude = wb["copyFiles.include"] as string[] | undefined;
  if (copyInclude?.length) {
    const copyExclude = wb["copyFiles.exclude"] as string[] | undefined;
    const copied = await copyFilesFromRepo(repo, wtPath, { include: copyInclude, exclude: copyExclude });
    if (copied.length) info(`Copied ${copied.length} file(s): ${copied.join(", ")}`);
  }

  // 3. Resolve env vars
  let env: Record<string, string> = {};
  if (existsSync(join(wtPath, wb.envFile))) {
    env = readEnvFile(wtPath, wb.envFile);
  } else {
    env = { ...(state.repo_env?.[repo] || {}) };
    if (!Object.keys(env).length && state.last_stand) {
      env = { STAND: state.last_stand };
    }
  }
  env = { ...env, ...envArgs };

  // Write env file
  if (Object.keys(env).length) {
    writeEnvFile(wtPath, env, wb.envFile);
    info(`Env: ${formatEnv(env)}`);
  }

  // Save as last_env for this repo
  if (Object.keys(env).length) {
    await writeState({ repo_env: { [repo]: env } });
  }

  // 5. postCreate hooks + plugins (only for new worktrees)
  const hEnv = hookEnv(taskId, branch, env, repo, wtPath);
  const allPlugins = registry.allPlugins();
  const pluginCtx: PluginContext = { taskId, branch, env, repo, wtPath };
  if (isNewWorktree) {
    await runHooks("postCreate", wb["hooks.postCreate"], hEnv, wtPath);
    for (const p of allPlugins) await p.postCreate?.(pluginCtx);
    await runHooks("postCreate (personal)", config["hooks.postCreate"], hEnv, wtPath);
  }

  // preStart hooks + plugins
  await runHooks("preStart", wb["hooks.preStart"], hEnv, wtPath);
  for (const p of allPlugins) await p.preStart?.(pluginCtx);
  await runHooks("preStart (personal)", config["hooks.preStart"], hEnv, wtPath);

  // Summary
  const lowerName = taskIdLower(taskId);
  console.log("");
  console.log("┌──────────────────────────────────────────────────────");
  console.log(`│ Task:      ${taskId}`);
  console.log("├──────────────────────────────────────────────────────");
  console.log(`│ Branch:    ${branch}`);
  console.log(`│ Path:      ${wtPath}`);
  if (Object.keys(env).length) console.log(`│ Env:       ${formatEnv(env)}`);
  console.log("└──────────────────────────────────────────────────────");
}

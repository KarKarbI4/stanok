import { $ } from "bun";
import {
  readConfigAsync,
  readEnvFile,
  listTasks,
  taskIdLower,
  loadRepoConfig,
  loadPluginRegistry,
  branchName,
  type PluginContext,
} from "@stanok/core/config";
import {
  WbError,
  info,
  requireRepo,
  hookEnv,
  runHooks,
} from "@stanok/core/utils";

export async function cmdPrune(args: string[], cwd?: string) {
  let dryRun = false;
  let lsMode = false;
  let jsonFormat = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--ls") lsMode = true;
    else if (arg === "--format=json") jsonFormat = true;
    else throw new WbError(`Unknown option: ${arg}`);
  }

  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;
  const tasks = await listTasks();
  const config = await readConfigAsync();
  const registry = await loadPluginRegistry(wb, config, repo);

  const quiet = lsMode && jsonFormat;

  if (!tasks.length && !lsMode) {
    info("No registered worktrees");
    return;
  }

  if (!quiet) info("Fetching latest changes...");
  await $`git -C ${repo} fetch origin ${wb.baseBranch} --quiet`.quiet().nothrow();

  // Collect merge commits from base branch that reference task IDs
  if (!quiet) info("Checking merged branches...");
  const masterLog = await $`git -C ${repo} log origin/${wb.baseBranch} --oneline --grep=${wb.mergeDetection}`.quiet().nothrow();
  const masterLogText = masterLog.text();

  const toRemove: typeof tasks = [];
  for (const t of tasks) {
    if (masterLogText.includes(t.task_id)) {
      toRemove.push(t);
    }
  }

  // Detect orphaned worktrees (exist on disk but no matching task)
  const taskIds = new Set(tasks.map((t) => t.task_id));
  const allPlugins = registry.allPlugins();
  const pruneIgnore = [
    ...(wb.pruneIgnore || []),
    ...allPlugins.flatMap((p) => p.pruneIgnore || []),
  ];
  const wtListResult = await $`git -C ${repo} worktree list --porcelain`.quiet().nothrow();
  const orphanedPaths: string[] = [];
  for (const line of wtListResult.text().split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const wtDir = line.slice("worktree ".length);
    if (wtDir === repo) continue;
    if (pruneIgnore.some((pattern) => new Bun.Glob(pattern).match(wtDir))) continue;
    const dirName = wtDir.split("/").pop() || "";
    const upper = dirName.toUpperCase();
    if (!taskIds.has(upper) && !toRemove.some((t) => t.path === wtDir)) {
      orphanedPaths.push(wtDir);
    }
  }

  // Detect stale tasks (no issue found in tracker)
  const mergedIds = new Set(toRemove.map((t) => t.task_id));
  const remainingTasks = tasks.filter((t) => !mergedIds.has(t.task_id));
  const staleTasks: string[] = [];
  const tracker = registry.issueTracker;
  if (remainingTasks.length && tracker) {
    let trackerReachable = false;
    try {
      await tracker.myself();
      trackerReachable = true;
    } catch {}

    if (trackerReachable) {
      const foundKeys = new Set<string>();
      for (const t of remainingTasks) {
        try {
          const results = await tracker.search(`key = ${t.task_id}`, 1);
          if (results.length) foundKeys.add(results[0].key);
        } catch {}
      }
      for (const t of remainingTasks) {
        if (!foundKeys.has(t.task_id)) staleTasks.push(t.task_id);
      }
    } else if (!quiet) {
      console.error("→ Issue tracker unavailable, skipping stale detection");
    }
  }

  if (lsMode) {
    if (jsonFormat) {
      console.log(
        JSON.stringify({
          merged: toRemove.map((t) => t.task_id),
          orphaned: orphanedPaths.map((p) => p.split("/").pop() || p),
          stale: staleTasks,
        }),
      );
    } else {
      if (!toRemove.length && !orphanedPaths.length && !staleTasks.length) {
        console.log("Nothing to prune");
      }
      if (toRemove.length) {
        console.log(`Merged (${toRemove.length}):`);
        for (const t of toRemove) console.log(`  ${t.task_id.padEnd(16)} ${t.branch}`);
      }
      if (orphanedPaths.length) {
        console.log(`Orphaned (${orphanedPaths.length}):`);
        for (const p of orphanedPaths) console.log(`  ${p.split("/").pop()}`);
      }
      if (staleTasks.length) {
        console.log(`Stale (${staleTasks.length}):`);
        for (const id of staleTasks) console.log(`  ${id}`);
      }
    }
    return;
  }

  // Stale tasks go into toRemove for cleanup
  const staleSet = new Set(staleTasks);
  for (const id of staleTasks) {
    const t = tasks.find((t) => t.task_id === id);
    if (t && !toRemove.some((r) => r.task_id === id)) toRemove.push(t);
  }

  if (!toRemove.length && !orphanedPaths.length) {
    info("Nothing to prune");
    return;
  }

  const mergedOnly = toRemove.filter((t) => !staleSet.has(t.task_id));
  const staleOnly = toRemove.filter((t) => staleSet.has(t.task_id));

  if (mergedOnly.length) {
    console.log(`Found ${mergedOnly.length} merged worktree(s):\n`);
    for (const t of mergedOnly) {
      console.log(`  ${t.task_id.padEnd(16)} ${t.branch}`);
    }
    console.log("");
  }

  if (staleOnly.length) {
    console.log(`Found ${staleOnly.length} stale worktree(s) (issue not found):\n`);
    for (const t of staleOnly) {
      console.log(`  ${t.task_id.padEnd(16)} ${t.branch}`);
    }
    console.log("");
  }

  if (orphanedPaths.length) {
    console.log(`Found ${orphanedPaths.length} orphaned worktree(s):\n`);
    for (const p of orphanedPaths) {
      console.log(`  ${p}`);
    }
    console.log("");
  }

  if (dryRun) {
    info("Dry run — no changes made");
    return;
  }

  // Remove orphaned worktrees
  for (const wtDir of orphanedPaths) {
    const dirName = wtDir.split("/").pop() || "";
    info(`Removing orphaned worktree ${dirName}`);
    const removeResult = await $`git -C ${repo} worktree remove ${wtDir} --force`.quiet().nothrow();
    if (removeResult.exitCode !== 0) {
      await $`rm -rf ${wtDir}`.quiet().nothrow();
    }
  }

  for (const t of toRemove) {
    const id = t.task_id;
    info(`Pruning ${id}...`);

    // Fire preStop hooks on all plugins
    const trc = loadRepoConfig(t.repo);
    const pruneRegistry = await loadPluginRegistry(trc.workbench, config, t.repo);
    const prunePlugins = pruneRegistry.allPlugins();
    const branch = t.branch;
    const env = t.env || {};
    const pruneCtx: PluginContext = {
      taskId: id,
      branch,
      env,
      repo: t.repo,
      wtPath: t.path,
    };
    for (const p of prunePlugins) await p.preStop?.(pruneCtx);

    // postRemove hooks + plugins (before deletion)
    const hEnv = hookEnv(id, branch, env, t.repo, t.path);
    await runHooks("postRemove", trc.workbench["hooks.postRemove"], hEnv, t.path);
    for (const p of prunePlugins) await p.postRemove?.(pruneCtx);

    // Remove worktree
    info(`Removing worktree ${id}`);
    const removeResult = await $`git -C ${repo} worktree remove ${t.path} --force`.quiet().nothrow();
    if (removeResult.exitCode !== 0) {
      await $`rm -rf ${t.path}`.quiet().nothrow();
    }

    // Delete local branch
    await $`git -C ${repo} branch -d ${t.branch}`.quiet().nothrow();

    info(`Pruned ${id}`);
  }

  const total = toRemove.length + orphanedPaths.length;
  info(`Removed ${total} worktree(s)`);
}

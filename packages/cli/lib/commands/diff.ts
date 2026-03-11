import { existsSync } from "fs";
import { $ } from "bun";
import {
  readTask,
  taskIdUpper,
  detectRepo,
  loadRepoConfig,
} from "@stanok/core/config";
import { WbError, requireRepo } from "@stanok/core/utils";
import { currentBranch, taskIdFromBranch } from "@stanok/core/utils";

export async function cmdDiff(args: string[], cwd?: string) {
  let taskId = "";
  let stat = false;
  const passthrough: string[] = [];

  for (const arg of args) {
    if (arg === "--stat") stat = true;
    else if (arg.startsWith("-")) passthrough.push(arg);
    else if (!taskId) taskId = arg;
    else passthrough.push(arg);
  }

  // Auto-detect task from current branch
  if (!taskId) {
    const dir = cwd || process.cwd();
    try {
      const repo = await detectRepo(dir);
      if (repo) {
        const rc = loadRepoConfig(repo);
        const branch = await currentBranch(dir);
        const detected = taskIdFromBranch(branch, rc.workbench.branchTemplate);
        if (detected) taskId = detected;
      }
    } catch {}
  }

  if (!taskId) throw new WbError("Usage: stanok diff [TASK_ID] [--stat]");

  const task = await readTask(taskId);
  if (!task) throw new WbError(`Task ${taskIdUpper(taskId)} not found`);
  if (!existsSync(task.path)) throw new WbError(`Worktree path does not exist: ${task.path}`);

  const rc = loadRepoConfig(task.repo);
  const baseBranch = rc.workbench.baseBranch;

  const gitArgs = ["diff", `origin/${baseBranch}...HEAD`];
  if (stat) gitArgs.push("--stat");
  gitArgs.push(...passthrough);

  const result = await $`git -C ${task.path} ${gitArgs}`.nothrow();
  process.exitCode = result.exitCode;
}

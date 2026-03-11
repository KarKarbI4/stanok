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

export async function cmdOpen(args: string[], cwd?: string) {
  let taskId = "";
  let target: "finder" | "terminal" = "finder";

  for (const arg of args) {
    if (arg === "--terminal" || arg === "-t") target = "terminal";
    else if (arg === "--finder" || arg === "-f") target = "finder";
    else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    else if (!taskId) taskId = arg;
    else throw new WbError(`Unexpected argument: ${arg}`);
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

  if (!taskId) throw new WbError("Usage: stanok open [TASK_ID] [--finder|--terminal]");

  const task = await readTask(taskId);
  if (!task) throw new WbError(`Task ${taskIdUpper(taskId)} not found`);
  if (!existsSync(task.path)) throw new WbError(`Worktree path does not exist: ${task.path}`);

  if (!process.env.SK_TEST) {
    if (target === "terminal") {
      if (process.env.TERM_PROGRAM === "iTerm.app") {
        const script = `tell application "iTerm"
  tell current window
    create tab with default profile
    tell current session of current tab
      write text "cd ${task.path}"
    end tell
  end tell
end tell`;
        await $`osascript -e ${script}`.quiet().nothrow();
      } else {
        await $`open -a Terminal ${task.path}`.quiet().nothrow();
      }
    } else {
      await $`open ${task.path}`.quiet().nothrow();
    }
  }

  console.log(`→ Opened ${task.path}`);
}

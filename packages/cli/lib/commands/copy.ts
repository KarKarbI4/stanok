import { existsSync } from "fs";
import {
  taskIdUpper,
  worktreePath,
  loadRepoConfig,
} from "@stanok/core/config";
import {
  WbError,
  info,
  requireRepo,
  currentBranch,
  taskIdFromBranch,
  copyFilesFromRepo,
} from "@stanok/core/utils";

export async function cmdCopy(args: string[], cwd?: string) {
  let taskId = "";

  for (const arg of args) {
    if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    else if (!taskId) taskId = arg;
    else throw new WbError(`Unexpected argument: ${arg}`);
  }

  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;

  if (!taskId) {
    try {
      const branch = await currentBranch(cwd);
      const detected = taskIdFromBranch(branch, wb.branchTemplate);
      if (!detected) throw new WbError(`Cannot detect task ID from branch '${branch}'. Usage: stanok copy [TASK_ID]`);
      taskId = detected;
    } catch (e) {
      if (e instanceof WbError) throw e;
      throw new WbError("Not in a git repository. Usage: stanok copy [TASK_ID]");
    }
  }

  taskId = taskIdUpper(taskId);
  const wtPath = worktreePath(repo, taskId);
  if (!existsSync(wtPath)) throw new WbError(`Worktree for ${taskId} not found at ${wtPath}`);

  const copyInclude = wb["copyFiles.include"] as string[] | undefined;
  if (!copyInclude?.length) {
    throw new WbError("No copyFiles.include configured in .stanok/settings.json");
  }

  const copyExclude = wb["copyFiles.exclude"] as string[] | undefined;
  const copied = await copyFilesFromRepo(repo, wtPath, { include: copyInclude, exclude: copyExclude });
  if (copied.length) {
    info(`Copied ${copied.length} file(s):`);
    for (const f of copied) console.log(`  ${f}`);
  } else {
    info("No files matched");
  }
}

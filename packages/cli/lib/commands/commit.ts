import { $ } from "bun";
import {
  detectRepo,
  taskIdUpper,
  loadRepoConfig,
} from "@stanok/core/config";
import { WbError, currentBranch, taskIdFromBranch } from "@stanok/core/utils";

export async function cmdCommit(args: string[], cwd?: string): Promise<number> {
  const message = args.join(" ");
  if (!message) throw new WbError("Usage: stanok c <message>");

  const dir = cwd || process.cwd();
  let taskId: string | null = null;
  try {
    const branch = await currentBranch(dir);
    const repo = await detectRepo(dir);
    const template = repo ? loadRepoConfig(repo).workbench.branchTemplate : "{task}";
    taskId = taskIdFromBranch(branch, template);
  } catch {}

  const full = taskId ? `${taskIdUpper(taskId)} | ${message}` : message;
  const result = await $`git -C ${dir} commit -m ${full}`.nothrow();
  return result.exitCode;
}

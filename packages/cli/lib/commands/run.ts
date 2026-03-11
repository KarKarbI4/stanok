import { existsSync } from "fs";
import {
  readEnvFile,
  taskIdUpper,
  worktreePath,
  branchName,
  loadRepoConfig,
} from "@stanok/core/config";
import { WbError, requireRepo, hookEnv } from "@stanok/core/utils";

export async function cmdRun(args: string[], cwd?: string): Promise<number> {
  if (args.length < 2) throw new WbError("Usage: stanok run <TASK_ID> <command...>");

  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const wb = rc.workbench;
  const taskId = taskIdUpper(args[0]);
  const command = args.slice(1).join(" ");

  const wtPath = worktreePath(repo, taskId);
  if (!existsSync(wtPath)) throw new WbError(`Worktree for ${taskId} not found at ${wtPath}`);

  const branch = branchName(taskId, wb.branchTemplate);
  const taskEnv = readEnvFile(wtPath);
  const env = hookEnv(taskId, branch, taskEnv, repo, wtPath);
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: wtPath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...env },
  });

  return await proc.exited;
}

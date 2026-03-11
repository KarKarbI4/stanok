import { $ } from "bun";

export async function getRemoteUrl(cwd?: string): Promise<string | null> {
  const dir = cwd || process.cwd();
  const result = await $`git -C ${dir} remote get-url origin`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.text().trim() || null;
}

export async function currentBranch(cwd?: string): Promise<string> {
  const dir = cwd || process.cwd();
  const result = await $`git -C ${dir} rev-parse --abbrev-ref HEAD`.quiet();
  return result.text().trim();
}

export function taskIdFromBranch(
  branch: string,
  template: string = "{task}",
): string | null {
  const idx = template.indexOf("{task}");
  if (idx < 0) return null;

  const before = template.slice(0, idx);
  const after = template.slice(idx + "{task}".length);

  if (before && !branch.startsWith(before)) return null;
  if (after && !branch.endsWith(after)) return null;

  const taskPart = branch.slice(before.length, after ? -after.length : undefined);
  if (!taskPart) return null;

  // Bare template "{task}" — only match task-ID-like branches
  if (!before && !after && !/^[A-Za-z][A-Za-z0-9]*-\d+/.test(taskPart)) return null;

  return taskPart;
}

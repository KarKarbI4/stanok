import { $ } from "bun";
import {
  listTasks,
  readConfigAsync,
  loadRepoConfig,
  loadPluginRegistry,
} from "@stanok/core/config";
import { WbError, formatEnv } from "@stanok/core/utils";

function relativeAge(isoDate: string): string {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return "";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

async function isDirty(path: string): Promise<boolean> {
  const result = await $`git -C ${path} status --porcelain`.quiet().nothrow();
  return result.exitCode === 0 && result.text().trim().length > 0;
}

export async function cmdList(args: string[], cwd?: string) {
  let format = "table";
  for (const arg of args) {
    if (arg === "--format=json") format = "json";
    else if (arg === "--format=ids") format = "ids";
    else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
  }

  const tasks = await listTasks();

  if (format === "json") {
    // Enrich tasks via plugins (best-effort, per repo)
    const byRepo = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const arr = byRepo.get(t.repo) || [];
      arr.push(t);
      byRepo.set(t.repo, arr);
    }
    const config = await readConfigAsync();
    for (const [repo, repoTasks] of byRepo) {
      try {
        const rc = loadRepoConfig(repo);
        const registry = await loadPluginRegistry(rc.workbench, config, repo);
        await registry.enrich(repoTasks);
      } catch {
        // silently skip — enrichment is best-effort
      }
    }
    console.log(JSON.stringify(tasks));
    return;
  }

  if (format === "ids") {
    for (const t of tasks) console.log(t.task_id);
    return;
  }

  // Check dirty status in parallel
  const dirtyResults = await Promise.all(tasks.map((t) => isDirty(t.path)));

  console.log(
    [
      "TASK".padEnd(16),
      "BRANCH".padEnd(24),
      "AGE".padEnd(6),
      "ENV",
    ].join(" "),
  );
  console.log(
    [
      "────".padEnd(16),
      "──────".padEnd(24),
      "───".padEnd(6),
      "───",
    ].join(" "),
  );

  if (!tasks.length) {
    console.log("(no registered worktrees)");
    return;
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const dirty = dirtyResults[i] ? "*" : "";
    const age = relativeAge(t.created_at);
    console.log(
      [
        (t.task_id + dirty).padEnd(16),
        t.branch.padEnd(24),
        age.padEnd(6),
        formatEnv(t.env || {}),
      ].join(" "),
    );
  }
}

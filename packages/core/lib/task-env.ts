import type { TaskMeta } from "./types";

export function taskEnv(t: TaskMeta): Record<string, string> {
  if (t.env && Object.keys(t.env).length) return t.env;
  return {};
}

export function envToArgs(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `--env ${k}=${v}`).join(" ");
}

export function envTags(env: Record<string, string>): { value: string; color: string }[] {
  return Object.entries(env).map(([k, v]) => ({
    value: k === "STAND" ? v : `${k}=${v}`,
    color: "Blue",
  }));
}

export function lastEnvFromTasks(tasks: TaskMeta[]): Record<string, string> {
  if (!tasks.length) return {};
  const sorted = [...tasks].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return taskEnv(sorted[0]);
}

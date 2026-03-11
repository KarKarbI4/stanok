import {
  List,
  ActionPanel,
  Action,
  Form,
  Icon,
  closeMainWindow,
  showToast,
  Toast,
  Color,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState, useMemo } from "react";
import { appendFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { execFile, spawn } from "child_process";
import { homedir } from "os";
import {
  parseTaskId, taskEnv, envToArgs, envTags as envTagsPlain,
  statusColor, loadStatusConfig, lastEnvFromTasks, filterTasks, filterTrackerIssues,
  type TaskMeta, type TrackerIssue,
} from "stanok";

const HOME = homedir();

interface PruneInfo {
  merged: string[];
  orphaned: string[];
  stale: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SHELL_ENV = {
  ...process.env,
  HOME,
  PATH: process.env.PATH || `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.bun/bin:${HOME}/.volta/bin:${HOME}/.cargo/bin`,
};

function getRepoCwd(): string | undefined {
  const stateFile = join(HOME, ".stanok", "state.json");
  if (!existsSync(stateFile)) return undefined;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    const repo = state.repos?.[0];
    return repo && existsSync(repo) ? repo : undefined;
  } catch { return undefined; }
}

function skExec(args: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("/bin/zsh", ["-l", "-c", `sk ${args}`], { env: SHELL_ENV, cwd: getRepoCwd() || HOME }, (err, stdout) => {
      if (err) { resolve(""); return; }
      resolve(stdout.trim());
    });
  });
}

function loadTasks(): Promise<TaskMeta[]> {
  return skExec("ls --format=json").then((out) => {
    try { return JSON.parse(out); } catch { return []; }
  });
}

function envTags(env: Record<string, string>): { tag: { value: string; color: Color } }[] {
  return envTagsPlain(env).map((t) => ({ tag: { value: t.value, color: Color.Blue } }));
}

// ─── Data fetchers (via CLI) ────────────────────────────────────────────────

function loadTrackerIssues(): Promise<TrackerIssue[]> {
  return skExec("issues --format=json").then((out) => {
    try { return JSON.parse(out); } catch { return []; }
  });
}

function checkPrunable(): Promise<PruneInfo> {
  return skExec("prune --ls --format=json").then((out) => {
    if (!out) return { merged: [], orphaned: [], stale: [] };
    try { return JSON.parse(out) as PruneInfo; } catch { return { merged: [], orphaned: [], stale: [] }; }
  });
}

// ─── Actions ────────────────────────────────────────────────────────────────

const LOG_PATH = join(HOME, ".stanok", "raycast.log");

function log(msg: string) {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
}

async function startWorkbench(taskId: string, taskEnvVars: Record<string, string>) {
  const args = envToArgs(taskEnvVars);
  const shellCmd = args ? `sk start ${taskId} ${args}` : `sk start ${taskId}`;

  log(`CMD: ${shellCmd}`);

  closeMainWindow();
  const toast = await showToast({ style: Toast.Style.Animated, title: `Starting ${taskId}...` });

  const proc = spawn("/bin/zsh", ["-l", "-c", shellCmd], { env: SHELL_ENV, cwd: getRepoCwd() || HOME, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    log(`STDOUT: ${text}`);
    const lines = text.split("\n");
    for (const line of lines) {
      const m = line.match(/^→\s+(.+)/);
      if (m) toast.title = `${taskId}: ${m[1]}`;
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
    log(`STDERR: ${data.toString()}`);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      log(`ERROR: exit code ${code}`);
      const msg = stderr.trim().split("\n").pop() || `exit code ${code}`;
      toast.style = Toast.Style.Failure;
      toast.title = `Failed: ${msg.slice(0, 80)}`;
    } else {
      log("OK");
      toast.style = Toast.Style.Success;
      toast.title = `${taskId} started`;
    }
  });
}

async function runPrune(count: number) {
  const shellCmd = `sk prune`;

  log(`CMD: ${shellCmd}`);
  closeMainWindow();
  const toast = await showToast({ style: Toast.Style.Animated, title: `Pruning ${count} worktrees...` });

  const proc = spawn("/bin/zsh", ["-l", "-c", shellCmd], { env: SHELL_ENV, cwd: getRepoCwd() || HOME });
  let stderr = "";

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    log(`STDOUT: ${text}`);
    const lines = text.split("\n");
    for (const line of lines) {
      const m = line.match(/^→\s+(.+)/);
      if (m) toast.title = m[1];
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
    log(`STDERR: ${data.toString()}`);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      log(`ERROR: exit code ${code}`);
      const msg = stderr.trim().split("\n").pop() || `exit code ${code}`;
      toast.style = Toast.Style.Failure;
      toast.title = `Prune failed: ${msg.slice(0, 80)}`;
    } else {
      log("Prune OK");
      toast.style = Toast.Style.Success;
      toast.title = `Pruned ${count} worktrees`;
    }
  });
}

async function stopAndRemove(taskId: string) {
  const shellCmd = `sk stop ${taskId} --remove`;

  log(`CMD: ${shellCmd}`);
  closeMainWindow();
  const toast = await showToast({ style: Toast.Style.Animated, title: `Removing ${taskId}...` });

  const proc = spawn("/bin/zsh", ["-l", "-c", shellCmd], { env: SHELL_ENV, cwd: getRepoCwd() || HOME });
  let stderr = "";

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    log(`STDOUT: ${text}`);
    const lines = text.split("\n");
    for (const line of lines) {
      const m = line.match(/^→\s+(.+)/);
      if (m) toast.title = m[1];
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
    log(`STDERR: ${data.toString()}`);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      log(`ERROR: exit code ${code}`);
      const msg = stderr.trim().split("\n").pop() || `exit code ${code}`;
      toast.style = Toast.Style.Failure;
      toast.title = `Failed: ${msg.slice(0, 80)}`;
    } else {
      log("OK");
      toast.style = Toast.Style.Success;
      toast.title = `Removed ${taskId}`;
    }
  });
}

// ─── Components ─────────────────────────────────────────────────────────────

function EnvForm({ taskId, summary, defaultEnv }: { taskId: string; summary?: string; defaultEnv: Record<string, string> }) {
  const keys = Object.keys(defaultEnv).length ? Object.keys(defaultEnv) : ["STAND"];
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Start Worktree"
            onSubmit={(values) => {
              const env: Record<string, string> = {};
              for (const k of keys) {
                const v = (values[k] as string || "").trim();
                if (v) env[k] = v;
              }
              startWorkbench(taskId, env);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Task" text={summary ? `${taskId}: ${summary}` : taskId} />
      {keys.map((k) => (
        <Form.TextField key={k} id={k} title={k} defaultValue={defaultEnv[k] || ""} placeholder={`e.g. ${k === "STAND" ? "dev1" : "value"}`} />
      ))}
    </Form>
  );
}

const statusColorMap: Record<string, Color> = {
  Blue: Color.Blue,
  Green: Color.Green,
  SecondaryText: Color.SecondaryText,
};

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const { data: tasks = [], isLoading: tasksLoading } = useCachedPromise(loadTasks, [], { keepPreviousData: true });

  const statusCfg = useMemo(() => loadStatusConfig(HOME), []);

  const getStatusColor = (status: string): Color => statusColorMap[statusColor(status, statusCfg)] ?? Color.SecondaryText;

  const lastEnv = useMemo(() => lastEnvFromTasks(tasks), [tasks]);

  const { data: trackerIssues = [] } = useCachedPromise(
    async () => loadTrackerIssues(),
    [],
    { keepPreviousData: true },
  );

  const { data: prunable } = useCachedPromise(
    async () => checkPrunable(),
    [],
    { keepPreviousData: true },
  );

  const mergedIds = useMemo(() => new Set(prunable?.merged || []), [prunable]);
  const orphanedIds = prunable?.orphaned || [];
  const staleIds = useMemo(() => new Set(prunable?.stale || []), [prunable]);

  const parsedId = parseTaskId(searchText);

  const existingIds = new Set(tasks.map((t) => t.task_id));
  const isNew = parsedId && !existingIds.has(parsedId);
  const pruneCount = tasks.filter((t) => mergedIds.has(t.task_id) || staleIds.has(t.task_id)).length + orphanedIds.length;

  const filteredTasks = filterTasks(tasks, searchText, parsedId);

  const filteredTrackerIssues = filterTrackerIssues(trackerIssues, existingIds, searchText, parsedId);

  return (
    <List searchBarPlaceholder="Task ID, name, or Jira URL..." onSearchTextChange={setSearchText} filtering={false} isLoading={tasksLoading}>
      {isNew && (
        <List.Section title="New">
          <List.Item
            title={parsedId}
            icon={{ source: Icon.Plus, tintColor: Color.Green }}
            accessories={envTags(lastEnv)}
            actions={
              <ActionPanel>
                <Action title="Start Worktree" icon={Icon.Play} onAction={() => startWorkbench(parsedId, lastEnv)} />
                <Action.Push
                  title="Start with Options..."
                  icon={Icon.Gear}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={<EnvForm taskId={parsedId} defaultEnv={lastEnv} />}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {pruneCount > 0 && !searchText && (() => {
        const mergedCount = tasks.filter((t) => mergedIds.has(t.task_id)).length;
        const staleCount = tasks.filter((t) => staleIds.has(t.task_id)).length;
        const parts: string[] = [];
        if (mergedCount) parts.push(`${mergedCount} merged`);
        if (staleCount) parts.push(`${staleCount} stale`);
        if (orphanedIds.length) parts.push(`${orphanedIds.length} orphaned`);
        const allIds = [...(prunable?.merged || []), ...orphanedIds, ...(prunable?.stale || [])];
        const subtitle = allIds.length ? allIds.join(", ") : "";
        return (
          <List.Section title="Prune">
            <List.Item
              title={`Prune ${pruneCount} worktrees`}
              subtitle={subtitle}
              icon={{ source: Icon.Trash, tintColor: Color.Red }}
              accessories={parts.map((p) => ({ tag: p }))}
              actions={
                <ActionPanel>
                  <Action title="Prune" icon={Icon.Trash} onAction={() => runPrune(pruneCount)} />
                </ActionPanel>
              }
            />
          </List.Section>
        );
      })()}

      {filteredTasks.length > 0 && (
        <List.Section title={`Worktrees (${tasks.length})`}>
          {filteredTasks.map((task) => (
            <List.Item
              key={task.task_id}
              title={task.task_id}
              subtitle={task.summary || ""}
              accessories={[
                ...(task.status ? [{ tag: { value: task.status, color: getStatusColor(task.status) } }] : []),
                ...(mergedIds.has(task.task_id) ? [{ icon: { source: Icon.CheckCircle, tintColor: Color.Green }, tooltip: "Merged" }] : []),
                ...(staleIds.has(task.task_id) ? [{ icon: { source: Icon.Warning, tintColor: Color.Orange }, tooltip: "Issue not found" }] : []),
                ...envTags(taskEnv(task)),
              ]}
              actions={
                <ActionPanel>
                  <Action title="Start Worktree" icon={Icon.Play} onAction={() => startWorkbench(task.task_id, { ...lastEnv, ...taskEnv(task) })} />
                  <Action.Push
                    title="Start with Options..."
                    icon={Icon.Gear}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    target={
                      <EnvForm taskId={task.task_id} summary={task.summary} defaultEnv={{ ...lastEnv, ...taskEnv(task) }} />
                    }
                  />
                  <Action
                    title="Stop & Remove"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => stopAndRemove(task.task_id)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {filteredTrackerIssues.length > 0 && (
        <List.Section title="My Tasks">
          {filteredTrackerIssues.map((issue) => (
            <List.Item
              key={issue.key}
              title={issue.key}
              subtitle={issue.summary}
              accessories={[{ tag: { value: issue.status, color: getStatusColor(issue.status) } }]}
              actions={
                <ActionPanel>
                  <Action title="Start Worktree" icon={Icon.Play} onAction={() => startWorkbench(issue.key, lastEnv)} />
                  <Action.Push
                    title="Start with Options..."
                    icon={Icon.Gear}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    target={<EnvForm taskId={issue.key} summary={issue.summary} defaultEnv={lastEnv} />}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

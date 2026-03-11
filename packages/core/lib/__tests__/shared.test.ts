import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseTaskId } from "../task-id";
import { taskEnv, envToArgs, envTags, lastEnvFromTasks } from "../task-env";
import { statusColor, loadStatusConfig } from "../status";
import { filterTasks, filterTrackerIssues } from "../filters";
import type { TaskMeta, StatusConfig } from "../types";
import type { TrackerIssue } from "../types";

const makeTask = (overrides: Partial<TaskMeta> = {}): TaskMeta => ({
  task_id: "TEST-1",
  branch: "feature/TEST-1",
  path: "/tmp/test-1",
  repo: "/tmp/repo",
  created_at: "2026-01-01",
  ...overrides,
});

const makeIssue = (overrides: Partial<TrackerIssue> = {}): TrackerIssue => ({
  key: "ISSUE-1",
  summary: "Test issue",
  status: "Open",
  has_workbench: false,
  ...overrides,
});

// ─── parseTaskId ─────────────────────────────────────────────────────────────

describe("parseTaskId", () => {
  test("extracts from Jira URL", () => {
    expect(parseTaskId("https://jira.example.com/browse/MP3UI-1811")).toBe("MP3UI-1811");
  });

  test("extracts from Jira URL with trailing path", () => {
    expect(parseTaskId("https://jira.example.com/browse/PROJ-42/details")).toBe("PROJ-42");
  });

  test("parses plain task ID", () => {
    expect(parseTaskId("MP3UI-1811")).toBe("MP3UI-1811");
  });

  test("uppercases lowercase input", () => {
    expect(parseTaskId("mp3ui-1811")).toBe("MP3UI-1811");
  });

  test("returns null for empty string", () => {
    expect(parseTaskId("")).toBeNull();
  });

  test("returns null for whitespace", () => {
    expect(parseTaskId("   ")).toBeNull();
  });

  test("returns null for plain text", () => {
    expect(parseTaskId("hello world")).toBeNull();
  });

  test("returns null for branch name", () => {
    expect(parseTaskId("feature/MP3UI-1811")).toBeNull();
  });

  test("trims whitespace around task ID", () => {
    expect(parseTaskId("  MP3UI-1811  ")).toBe("MP3UI-1811");
  });

  test("handles URL with query params", () => {
    expect(parseTaskId("https://jira.example.com/browse/PROJ-99?filter=1")).toBe("PROJ-99");
  });

  test("handles single letter project key", () => {
    expect(parseTaskId("X-1")).toBe("X-1");
  });

  test("rejects numeric-only string", () => {
    expect(parseTaskId("12345")).toBeNull();
  });

  test("rejects ID without dash", () => {
    expect(parseTaskId("PROJ")).toBeNull();
  });
});

// ─── taskEnv ─────────────────────────────────────────────────────────────────

describe("taskEnv", () => {
  test("returns env when present", () => {
    const task = makeTask({ env: { STAND: "dev1" } });
    expect(taskEnv(task)).toEqual({ STAND: "dev1" });
  });

  test("returns empty object when env is empty", () => {
    const task = makeTask({ env: {} });
    expect(taskEnv(task)).toEqual({});
  });

  test("returns empty object when env is undefined", () => {
    const task = makeTask({ env: undefined });
    expect(taskEnv(task)).toEqual({});
  });

  test("returns multiple env vars", () => {
    const task = makeTask({ env: { STAND: "dev1", API: "http://localhost" } });
    expect(taskEnv(task)).toEqual({ STAND: "dev1", API: "http://localhost" });
  });
});

// ─── envToArgs ───────────────────────────────────────────────────────────────

describe("envToArgs", () => {
  test("single env var", () => {
    expect(envToArgs({ STAND: "dev1" })).toBe("--env STAND=dev1");
  });

  test("multiple env vars", () => {
    expect(envToArgs({ STAND: "dev1", API: "http://localhost" })).toBe(
      "--env STAND=dev1 --env API=http://localhost",
    );
  });

  test("empty env returns empty string", () => {
    expect(envToArgs({})).toBe("");
  });
});

// ─── envTags ─────────────────────────────────────────────────────────────────

describe("envTags", () => {
  test("STAND key shows only value", () => {
    const tags = envTags({ STAND: "dev1" });
    expect(tags).toEqual([{ value: "dev1", color: "Blue" }]);
  });

  test("non-STAND key shows KEY=VALUE", () => {
    const tags = envTags({ API: "http://localhost" });
    expect(tags).toEqual([{ value: "API=http://localhost", color: "Blue" }]);
  });

  test("multiple env vars", () => {
    const tags = envTags({ STAND: "dev1", API: "http://localhost" });
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ value: "dev1", color: "Blue" });
    expect(tags[1]).toEqual({ value: "API=http://localhost", color: "Blue" });
  });

  test("empty env returns empty array", () => {
    expect(envTags({})).toEqual([]);
  });
});

// ─── statusColor — defaults ─────────────────────────────────────────────────

describe("statusColor — defaults", () => {
  test("In Progress → Blue", () => {
    expect(statusColor("In Progress")).toBe("Blue");
  });

  test("In Review → Blue", () => {
    expect(statusColor("In Review")).toBe("Blue");
  });

  test("Stop Progress → Blue", () => {
    expect(statusColor("Stop Progress")).toBe("Blue");
  });

  test("Pending → Blue", () => {
    expect(statusColor("Pending")).toBe("Blue");
  });

  test("Ready for Testing → Blue", () => {
    expect(statusColor("Ready for Testing")).toBe("Blue");
  });

  test("In Testing → Blue", () => {
    expect(statusColor("In Testing")).toBe("Blue");
  });

  test("Stop Testing → Blue", () => {
    expect(statusColor("Stop Testing")).toBe("Blue");
  });

  test("Done → Green", () => {
    expect(statusColor("Done")).toBe("Green");
  });

  test("Closed → Green", () => {
    expect(statusColor("Closed")).toBe("Green");
  });

  test("Resolved → Green", () => {
    expect(statusColor("Resolved")).toBe("Green");
  });

  test("Tested → Green", () => {
    expect(statusColor("Tested")).toBe("Green");
  });

  test("Deployed → Green", () => {
    expect(statusColor("Deployed")).toBe("Green");
  });

  test("Open → SecondaryText", () => {
    expect(statusColor("Open")).toBe("SecondaryText");
  });

  test("Reopened → SecondaryText", () => {
    expect(statusColor("Reopened")).toBe("SecondaryText");
  });

  test("Backlog → SecondaryText", () => {
    expect(statusColor("Backlog")).toBe("SecondaryText");
  });

  test("unknown status → SecondaryText", () => {
    expect(statusColor("Something Else")).toBe("SecondaryText");
  });

  test("case insensitive", () => {
    expect(statusColor("IN PROGRESS")).toBe("Blue");
    expect(statusColor("in progress")).toBe("Blue");
    expect(statusColor("DONE")).toBe("Green");
    expect(statusColor("done")).toBe("Green");
    expect(statusColor("OPEN")).toBe("SecondaryText");
  });
});

// ─── statusColor — custom config ────────────────────────────────────────────

describe("statusColor — custom config", () => {
  const cfg: StatusConfig = {
    open: ["To Do", "New"],
    inProgress: ["Working", "Review"],
    done: ["Shipped", "Released"],
  };

  test("custom inProgress status → Blue", () => {
    expect(statusColor("Working", cfg)).toBe("Blue");
    expect(statusColor("Review", cfg)).toBe("Blue");
  });

  test("custom done status → Green", () => {
    expect(statusColor("Shipped", cfg)).toBe("Green");
    expect(statusColor("Released", cfg)).toBe("Green");
  });

  test("custom open status → SecondaryText", () => {
    expect(statusColor("To Do", cfg)).toBe("SecondaryText");
    expect(statusColor("New", cfg)).toBe("SecondaryText");
  });

  test("status not in any group → SecondaryText", () => {
    expect(statusColor("Random", cfg)).toBe("SecondaryText");
  });

  test("custom config is case insensitive", () => {
    expect(statusColor("working", cfg)).toBe("Blue");
    expect(statusColor("SHIPPED", cfg)).toBe("Green");
    expect(statusColor("to do", cfg)).toBe("SecondaryText");
  });

  test("partial config uses defaults for missing groups", () => {
    const partial: StatusConfig = { done: ["Merged"] };
    expect(statusColor("Merged", partial)).toBe("Green");
    expect(statusColor("In Progress", partial)).toBe("Blue");
    expect(statusColor("Open", partial)).toBe("SecondaryText");
    // Old done statuses no longer match since overridden
    expect(statusColor("Done", partial)).toBe("SecondaryText");
  });

  test("done takes priority over inProgress", () => {
    const overlap: StatusConfig = {
      inProgress: ["Testing"],
      done: ["Testing"],
    };
    expect(statusColor("Testing", overlap)).toBe("Green");
  });

  test("empty arrays override defaults", () => {
    const empty: StatusConfig = { done: [], inProgress: [] };
    expect(statusColor("Done")).toBe("Green"); // default
    expect(statusColor("Done", empty)).toBe("SecondaryText"); // overridden to empty
  });
});

// ─── loadStatusConfig ────────────────────────────────────────────────────────

describe("loadStatusConfig", () => {
  test("returns empty object when ui.json doesn't exist", () => {
    const tmpDir = join(tmpdir(), `rc-cfg-${Date.now()}-1`);
    mkdirSync(tmpDir, { recursive: true });
    const result = loadStatusConfig(tmpDir);
    expect(result).toEqual({});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads statusColors from ui.json", () => {
    const tmpDir = join(tmpdir(), `rc-cfg-${Date.now()}-2`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".stanok", "ui.json"),
      JSON.stringify({ statusColors: { open: ["A"], inProgress: ["B"], done: ["C"] } }),
    );
    const result = loadStatusConfig(tmpDir);
    expect(result).toEqual({ open: ["A"], inProgress: ["B"], done: ["C"] });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty object when ui.json has no statusColors", () => {
    const tmpDir = join(tmpdir(), `rc-cfg-${Date.now()}-3`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "ui.json"), "{}");
    const result = loadStatusConfig(tmpDir);
    expect(result).toEqual({});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty object when ui.json is invalid JSON", () => {
    const tmpDir = join(tmpdir(), `rc-cfg-${Date.now()}-4`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "ui.json"), "not json");
    const result = loadStatusConfig(tmpDir);
    expect(result).toEqual({});
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─── lastEnvFromTasks ────────────────────────────────────────────────────────

describe("lastEnvFromTasks", () => {
  test("returns empty object for empty tasks", () => {
    expect(lastEnvFromTasks([])).toEqual({});
  });

  test("returns env from most recently created task", () => {
    const tasks = [
      makeTask({ task_id: "OLD-1", created_at: "2026-01-01", env: { STAND: "old" } }),
      makeTask({ task_id: "NEW-1", created_at: "2026-03-01", env: { STAND: "new" } }),
    ];
    expect(lastEnvFromTasks(tasks)).toEqual({ STAND: "new" });
  });

  test("returns empty object when latest task has no env", () => {
    const tasks = [
      makeTask({ task_id: "OLD-1", created_at: "2026-01-01", env: { STAND: "old" } }),
      makeTask({ task_id: "NEW-1", created_at: "2026-03-01", env: {} }),
    ];
    expect(lastEnvFromTasks(tasks)).toEqual({});
  });

  test("single task returns its env", () => {
    const tasks = [makeTask({ env: { STAND: "dev1" } })];
    expect(lastEnvFromTasks(tasks)).toEqual({ STAND: "dev1" });
  });

  test("handles tasks with empty created_at", () => {
    const tasks = [
      makeTask({ task_id: "A-1", created_at: "", env: { STAND: "a" } }),
      makeTask({ task_id: "B-1", created_at: "2026-01-01", env: { STAND: "b" } }),
    ];
    // "2026-01-01" > "" so B-1 is sorted first
    expect(lastEnvFromTasks(tasks)).toEqual({ STAND: "b" });
  });
});

// ─── filterTasks ─────────────────────────────────────────────────────────────

describe("filterTasks", () => {
  const tasks: TaskMeta[] = [
    makeTask({ task_id: "MP3UI-100", summary: "Login page" }),
    makeTask({ task_id: "MP3UI-200", summary: "Dashboard fix" }),
    makeTask({ task_id: "BACK-300", summary: "API endpoint" }),
  ];

  test("empty search returns all tasks", () => {
    expect(filterTasks(tasks, "", null)).toHaveLength(3);
  });

  test("parsedId filters to exact match", () => {
    const result = filterTasks(tasks, "MP3UI-100", "MP3UI-100");
    expect(result).toHaveLength(1);
    expect(result[0].task_id).toBe("MP3UI-100");
  });

  test("parsedId with no match returns empty", () => {
    expect(filterTasks(tasks, "NEW-999", "NEW-999")).toHaveLength(0);
  });

  test("text search matches task_id substring", () => {
    const result = filterTasks(tasks, "mp3ui", null);
    expect(result).toHaveLength(2);
  });

  test("text search matches summary substring", () => {
    const result = filterTasks(tasks, "dashboard", null);
    expect(result).toHaveLength(1);
    expect(result[0].task_id).toBe("MP3UI-200");
  });

  test("text search is case insensitive", () => {
    const result = filterTasks(tasks, "LOGIN", null);
    expect(result).toHaveLength(1);
    expect(result[0].task_id).toBe("MP3UI-100");
  });

  test("no match returns empty array", () => {
    expect(filterTasks(tasks, "xyz", null)).toHaveLength(0);
  });

  test("handles tasks without summary", () => {
    const noSummary = [makeTask({ task_id: "X-1", summary: undefined })];
    expect(filterTasks(noSummary, "x-1", null)).toHaveLength(1);
    expect(filterTasks(noSummary, "nosuchsummary", null)).toHaveLength(0);
  });
});

// ─── filterTrackerIssues ─────────────────────────────────────────────────────

describe("filterTrackerIssues", () => {
  const issues: TrackerIssue[] = [
    makeIssue({ key: "PROJ-1", summary: "Login feature" }),
    makeIssue({ key: "PROJ-2", summary: "Signup flow" }),
    makeIssue({ key: "PROJ-3", summary: "Dashboard" }),
  ];

  test("empty search returns all non-existing issues", () => {
    const result = filterTrackerIssues(issues, new Set(), "", null);
    expect(result).toHaveLength(3);
  });

  test("filters out existing task IDs", () => {
    const existing = new Set(["PROJ-1"]);
    const result = filterTrackerIssues(issues, existing, "", null);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.key === "PROJ-1")).toBeUndefined();
  });

  test("parsedId filters to exact match", () => {
    const result = filterTrackerIssues(issues, new Set(), "PROJ-2", "PROJ-2");
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("PROJ-2");
  });

  test("parsedId with no match returns empty", () => {
    expect(filterTrackerIssues(issues, new Set(), "NEW-99", "NEW-99")).toHaveLength(0);
  });

  test("text search matches key substring", () => {
    const result = filterTrackerIssues(issues, new Set(), "proj", null);
    expect(result).toHaveLength(3);
  });

  test("text search matches summary substring", () => {
    const result = filterTrackerIssues(issues, new Set(), "signup", null);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("PROJ-2");
  });

  test("text search is case insensitive", () => {
    const result = filterTrackerIssues(issues, new Set(), "DASHBOARD", null);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("PROJ-3");
  });

  test("combined: filters existing AND searches", () => {
    const existing = new Set(["PROJ-1"]);
    const result = filterTrackerIssues(issues, existing, "proj", null);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.key === "PROJ-1")).toBeUndefined();
  });

  test("no match returns empty array", () => {
    expect(filterTrackerIssues(issues, new Set(), "xyz", null)).toHaveLength(0);
  });
});

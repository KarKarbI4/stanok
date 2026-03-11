import { describe, expect, test, afterEach, beforeEach, spyOn } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { jiraPlugin } from "@stanok/plugin-jira";
import { WbError } from "@stanok/core/utils";
import type { AuthResolver } from "@stanok/core/plugin";

const JIRA_URL = "http://test-jira.local";

function writeAuth(home: string) {
  writeFileSync(
    join(home, ".stanok", "auth.json"),
    JSON.stringify({ [JIRA_URL]: { token: "fake-token" } }, null, 2) + "\n",
  );
}

function makeIssuesCmd() {
  const settings = { ...jiraPlugin.settings, "jira.url": JIRA_URL };
  const auth: AuthResolver = (u) => u === JIRA_URL ? { token: "fake-token" } : null;
  return jiraPlugin.commands!.issues(settings, auth)!;
}

describe("tasks (issues command)", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let fetchSpy: ReturnType<typeof spyOn>;

  const myIssues = [
    { key: "TASK-1", fields: { summary: "Fix login", status: { name: "In Progress" }, issuetype: { name: "Bug" }, priority: { name: "High" } } },
    { key: "TASK-2", fields: { summary: "Add feature", status: { name: "Open" }, issuetype: { name: "Story" }, priority: { name: "Medium" } } },
    { key: "TASK-3", fields: { summary: "Refactor", status: { name: "In Review" }, issuetype: { name: "Task" }, priority: { name: "Low" } } },
  ];

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      // myIssues search (JQL with currentUser)
      if (url.includes("/rest/api/2/search") && decodeURIComponent(url).includes("currentUser")) {
        return new Response(JSON.stringify({ issues: myIssues }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // getIssue for cmdStart validation
      const issueMatch = url.match(/\/rest\/api\/2\/issue\/([^?]+)/);
      if (issueMatch) {
        const key = issueMatch[1];
        const found = myIssues.find((i) => i.key === key);
        return new Response(
          JSON.stringify({
            key,
            fields: found?.fields || { summary: key, status: { name: "Open" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    });
  });

  afterEach(() => {
    env?.cleanup();
    fetchSpy.mockRestore();
  });

  test("shows issues from tracker in table format", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": JIRA_URL });
    writeAuth(env.home);

    const cmd = makeIssuesCmd();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run([], env.repo)),
    );

    expect(stdout).toContain("TASK-1");
    expect(stdout).toContain("Fix login");
    expect(stdout).toContain("TASK-2");
    expect(stdout).toContain("Add feature");
    expect(stdout).toContain("TASK-3");
  });

  test("--format=json returns array with has_workbench flag", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": JIRA_URL });
    writeAuth(env.home);
    await withTestEnv(env, () => cmdStart(["TASK-1"], env.repo));

    const cmd = makeIssuesCmd();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run(["--format=json"], env.repo)),
    );

    const issues = JSON.parse(stdout);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBe(3);

    const task1 = issues.find((i: any) => i.key === "TASK-1");
    expect(task1.has_workbench).toBe(true);
    expect(task1.summary).toBe("Fix login");

    const task2 = issues.find((i: any) => i.key === "TASK-2");
    expect(task2.has_workbench).toBe(false);
  });

  test("marks existing workbenches with dot in table", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": JIRA_URL });
    writeAuth(env.home);
    await withTestEnv(env, () => cmdStart(["TASK-2"], env.repo));

    const cmd = makeIssuesCmd();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run([], env.repo)),
    );

    const lines = stdout.split("\n");
    const task2Line = lines.find((l) => l.includes("TASK-2"));
    expect(task2Line).toContain("●");

    const task1Line = lines.find((l) => l.includes("TASK-1"));
    expect(task1Line).not.toContain("●");
  });

  test("issues command returns null when no jira url", () => {
    const settings = { ...jiraPlugin.settings };
    const auth: AuthResolver = () => ({ token: "t" });
    const cmd = jiraPlugin.commands!.issues(settings, auth);
    expect(cmd).toBeNull();
  });

  test("throws on unknown flag", async () => {
    env = await createTempRepo();
    const cmd = makeIssuesCmd();
    expect(
      withTestEnv(env, () => cmd.run(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

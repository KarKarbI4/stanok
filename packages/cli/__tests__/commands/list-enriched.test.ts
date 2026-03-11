import { describe, expect, test, afterEach, beforeEach, spyOn } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { createTempRepo, writeWorkbenchJson, writeWbConfig, writePluginsTs, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdList } from "../../lib/commands/list";

const JIRA_URL = "http://test-jira.local";

function writeAuth(home: string) {
  writeFileSync(
    join(home, ".stanok", "auth.json"),
    JSON.stringify({ [JIRA_URL]: { token: "fake-token" } }, null, 2) + "\n",
  );
}

function jiraSearchResponse(keys: string[]) {
  return {
    issues: keys.map((key) => ({
      key,
      fields: {
        summary: `Summary for ${key}`,
        status: { name: "In Progress" },
        issuetype: { name: "Task" },
        priority: { name: "Medium" },
      },
    })),
  };
}

describe("ls --format=json enrichment", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/rest/api/2/search")) {
        // Extract keys from JQL: key in (ENRICH-1,ENRICH-2)
        const jqlMatch = decodeURIComponent(url).match(/key in \(([^)]+)\)/);
        const keys = jqlMatch ? jqlMatch[1].split(",") : [];
        return new Response(JSON.stringify(jiraSearchResponse(keys)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // getIssue fallback
      const issueMatch = url.match(/\/rest\/api\/2\/issue\/([^?]+)/);
      if (issueMatch) {
        const key = issueMatch[1];
        return new Response(
          JSON.stringify({
            key,
            fields: {
              summary: `Summary for ${key}`,
              status: { name: "In Progress" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // myself endpoint
      if (url.includes("/myself")) {
        return new Response(JSON.stringify({ name: "testuser", displayName: "Test User" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });
  });

  afterEach(() => {
    env?.cleanup();
    fetchSpy.mockRestore();
  });

  test("includes summary and status when tracker available", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": JIRA_URL });
    writePluginsTs(env.home, ["jira"]);
    writeAuth(env.home);
    await withTestEnv(env, () => cmdStart(["ENRICH-1"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=json"], env.repo)),
    );

    const tasks = JSON.parse(stdout);
    const task = tasks.find((t: any) => t.task_id === "ENRICH-1");
    expect(task).toBeDefined();
    expect(task.summary).toBe("Summary for ENRICH-1");
    expect(task.status).toBe("In Progress");
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("json output has no summary/status without tracker config", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {}); // No jira.url
    await withTestEnv(env, () => cmdStart(["ENRICH-2"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=json"], env.repo)),
    );

    const tasks = JSON.parse(stdout);
    const task = tasks.find((t: any) => t.task_id === "ENRICH-2");
    expect(task).toBeDefined();
    expect(task.summary).toBeUndefined();
    expect(task.status).toBeUndefined();
  });

  test("swallows tracker errors gracefully", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": JIRA_URL });
    writePluginsTs(env.home, ["jira"]);
    writeAuth(env.home);
    await withTestEnv(env, () => cmdStart(["ENRICH-3"], env.repo));

    // Make fetch fail
    fetchSpy.mockImplementation(async () => {
      throw new Error("network error");
    });

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=json"], env.repo)),
    );

    const tasks = JSON.parse(stdout);
    const task = tasks.find((t: any) => t.task_id === "ENRICH-3");
    expect(task).toBeDefined();
    expect(task.summary).toBeUndefined();
    expect(task.status).toBeUndefined();
  });
});

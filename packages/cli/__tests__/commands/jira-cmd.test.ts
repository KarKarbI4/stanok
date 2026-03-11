import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { jiraPlugin } from "@stanok/plugin-jira";
import { WbError } from "@stanok/core/utils";
import type { AuthResolver } from "@stanok/core/plugin";

function makeIssueCmd(url: string, token: string) {
  const settings = { ...jiraPlugin.settings, "jira.url": url };
  const auth: AuthResolver = (u) => u === url ? { token } : null;
  return jiraPlugin.commands!.issue(settings, auth)!;
}

describe("jira (issue command)", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    env?.cleanup();
  });

  test("--text shows issue info", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/rest/api/2/issue/JIRA-1")) {
        return new Response(
          JSON.stringify({
            key: "JIRA-1",
            fields: {
              summary: "Fix login bug",
              status: { name: "Open" },
              issuetype: { name: "Bug" },
              priority: { name: "High" },
              assignee: { displayName: "John Doe" },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run(["JIRA-1", "--text"], env.repo)),
    );
    expect(stdout).toContain("JIRA-1");
    expect(stdout).toContain("Fix login bug");
    expect(stdout).toContain("Open");
    expect(stdout).toContain("Bug");
  });

  test("--text long description is truncated", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    const longDesc = "A".repeat(600);
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/rest/api/2/issue/JIRA-2")) {
        return new Response(
          JSON.stringify({
            key: "JIRA-2",
            fields: {
              summary: "Long desc",
              status: { name: "Open" },
              issuetype: { name: "Task" },
              priority: { name: "Medium" },
              assignee: null,
              description: longDesc,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run(["JIRA-2", "--text"], env.repo)),
    );
    expect(stdout).toContain("...");
    expect(stdout).toContain("Unassigned");
  });

  test("browser open (default)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run(["JIRA-3"], env.repo)),
    );
    expect(stdout).toContain("Opening");
    expect(stdout).toContain("jira.test/browse/JIRA-3");
  });

  test("auto-detect from branch", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "fake-jira-token" } }),
    );
    await withTestEnv(env, () => cmdStart(["JIRA-4"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "jira-4");

    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmd.run([], wtPath)),
    );
    expect(stdout).toContain("Opening");
    expect(stdout).toContain("JIRA-4");
  });

  test("issue command returns null when no jira url", () => {
    const settings = { ...jiraPlugin.settings };
    const auth: AuthResolver = () => ({ token: "t" });
    const cmd = jiraPlugin.commands!.issue(settings, auth);
    expect(cmd).toBeNull();
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    expect(
      withTestEnv(env, () => cmd.run(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("not in git repo throws WbError", async () => {
    env = await createTempRepo();
    const tmpDir = join(require("os").tmpdir(), `wb-jnogit-${Date.now()}`);
    require("fs").mkdirSync(tmpDir, { recursive: true });

    const cmd = makeIssueCmd("http://jira.test", "fake-jira-token");
    try {
      await withTestEnv(env, () => cmd.run([], tmpDir));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("Not in a git repository");
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

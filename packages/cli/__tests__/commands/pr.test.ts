import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempRepo, writeWorkbenchJson, writePluginsTs, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdPr } from "../../lib/commands/pr";
import { WbError } from "@stanok/core/utils";

describe("pr", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    env?.cleanup();
  });

  function setupBBConfig() {
    writeWorkbenchJson(env.repo, {
      "bitbucket.url": "http://bb.test", "bitbucket.repo": "projects/X/repos/Y",
    });
    writePluginsTs(env.home, ["bitbucket"]);
    // Pre-set auth
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://bb.test": { token: "fake-bb-token" } }),
    );
  }

  test("existing PR → opens", async () => {
    env = await createTempRepo();
    setupBBConfig();
    await withTestEnv(env, () => cmdStart(["PR-1"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-1");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/pull-requests")) {
        return new Response(
          JSON.stringify({
            values: [{ id: 42, title: "PR-1: Fix", state: "OPEN", links: { self: [{ href: "" }] } }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPr([], wtPath)),
    );
    expect(stdout).toContain("Opening PR #42");
  });

  test("no PR → opens create page", async () => {
    env = await createTempRepo();
    setupBBConfig();
    await withTestEnv(env, () => cmdStart(["PR-2"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-2");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/pull-requests")) {
        return new Response(JSON.stringify({ values: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPr([], wtPath)),
    );
    expect(stdout).toContain("opening create page");
  });

  test("--build success shows build status", async () => {
    env = await createTempRepo();
    setupBBConfig();
    await withTestEnv(env, () => cmdStart(["PR-3"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-3");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/commits?until=")) {
        return new Response(JSON.stringify({ values: [{ id: "abc123" }] }), { status: 200 });
      }
      if (url.includes("/build-status/")) {
        return new Response(
          JSON.stringify({
            values: [{ state: "SUCCESSFUL", key: "b1", name: "CI", url: "http://bamboo.test/browse/PLAN-1" }],
          }),
          { status: 200 },
        );
      }
      // fetchBuildLog
      if (url.includes("/rest/api/latest/result/")) {
        return new Response(
          JSON.stringify({
            stages: { stage: [{ results: { result: [{ buildResultKey: "PLAN-JOB1-1", state: "Successful" }] } }] },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/download/")) {
        return new Response("build log output", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout, stderr } = await captureOutput(() =>
      withTestEnv(env, () => cmdPr(["--build"], wtPath)),
    );
    expect(stderr).toContain("SUCCESSFUL");
  });

  test("--build no builds throws WbError", async () => {
    env = await createTempRepo();
    setupBBConfig();
    await withTestEnv(env, () => cmdStart(["PR-4"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-4");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/commits?until=")) {
        return new Response(JSON.stringify({ values: [{ id: "abc" }] }), { status: 200 });
      }
      if (url.includes("/build-status/")) {
        return new Response(JSON.stringify({ values: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      await withTestEnv(env, () => cmdPr(["--build"], wtPath));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("No builds");
    }
  });

  test("--build failed throws WbError", async () => {
    env = await createTempRepo();
    setupBBConfig();
    await withTestEnv(env, () => cmdStart(["PR-5"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-5");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/commits?until=")) {
        return new Response(JSON.stringify({ values: [{ id: "abc" }] }), { status: 200 });
      }
      if (url.includes("/build-status/")) {
        return new Response(
          JSON.stringify({
            values: [{ state: "FAILED", key: "b1", name: "CI", url: "http://bamboo.test/nope" }],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      await withTestEnv(env, () => cmdPr(["--build"], wtPath));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("Build failed");
    }
  });

  test("no BB config throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["PR-6"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "pr-6");

    try {
      await withTestEnv(env, () => cmdPr([], wtPath));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("No code host detected");
    }
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdPr(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

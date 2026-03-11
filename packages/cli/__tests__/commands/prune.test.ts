import { describe, expect, test, afterEach, mock } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { $ } from "bun";
import { createTempRepo, writeWorkbenchJson, writePluginsTs, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdPrune } from "../../lib/commands/prune";
import { WbError } from "@stanok/core/utils";

describe("prune", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("merged branch worktree is removed", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["PRUNE-1"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "prune-1");

    // Make a commit in worktree
    writeFileSync(join(wtPath, "change.txt"), "change\n");
    await $`git -C ${wtPath} add change.txt`.quiet();
    await $`git -C ${wtPath} commit -m "PRUNE-1 change"`.quiet();
    await $`git -C ${wtPath} push -u origin PRUNE-1`.quiet();

    // Simulate merge
    await $`git -C ${env.repo} checkout master`.quiet();
    await $`git -C ${env.repo} merge PRUNE-1 --no-ff -m "Pull request #1: PRUNE-1"`.quiet();
    await $`git -C ${env.repo} push origin master`.quiet();

    await withTestEnv(env, () => cmdPrune([], env.repo));

    expect(existsSync(wtPath)).toBe(false);
  });

  test("unmerged branch worktree is preserved", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["PRUNE-2"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "prune-2");

    await withTestEnv(env, () => cmdPrune([], env.repo));

    expect(existsSync(wtPath)).toBe(true);
  });

  test("--dry-run doesn't delete anything", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["PRUNE-3"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "prune-3");

    // Simulate merge
    writeFileSync(join(wtPath, "f.txt"), "f\n");
    await $`git -C ${wtPath} add f.txt`.quiet();
    await $`git -C ${wtPath} commit -m "PRUNE-3 change"`.quiet();
    await $`git -C ${wtPath} push -u origin PRUNE-3`.quiet();
    await $`git -C ${env.repo} checkout master`.quiet();
    await $`git -C ${env.repo} merge PRUNE-3 --no-ff -m "Pull request #2: PRUNE-3"`.quiet();
    await $`git -C ${env.repo} push origin master`.quiet();

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--dry-run"], env.repo)),
    );
    expect(stdout).toContain("Dry run");

    expect(existsSync(wtPath)).toBe(true);
  });

  test("--ls plain output shows Merged heading", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["PRUNE-LS1"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "prune-ls1");

    writeFileSync(join(wtPath, "f.txt"), "f\n");
    await $`git -C ${wtPath} add f.txt`.quiet();
    await $`git -C ${wtPath} commit -m "PRUNE-LS1 change"`.quiet();
    await $`git -C ${wtPath} push -u origin PRUNE-LS1`.quiet();
    await $`git -C ${env.repo} checkout master`.quiet();
    await $`git -C ${env.repo} merge PRUNE-LS1 --no-ff -m "Pull request #3: PRUNE-LS1"`.quiet();
    await $`git -C ${env.repo} push origin master`.quiet();

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls"], env.repo)),
    );
    expect(stdout).toContain("Merged");
  });

  test("--ls --format=json returns valid JSON", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls", "--format=json"], env.repo)),
    );
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("merged");
    expect(data).toHaveProperty("orphaned");
    expect(data).toHaveProperty("stale");
  });

  test("nothing to prune shows message", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls"], env.repo)),
    );
    expect(stdout).toContain("Nothing to prune");
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdPrune(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("no registered worktrees shows message", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune([], env.repo)),
    );
    expect(stdout).toContain("No registered worktrees");
  });

  test("orphaned worktree removed", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    // Create a worktree directly (not through cmdStart), so it's "orphaned"
    const orphanPath = resolve(env.repo, "..", "repo__worktrees", "orphan-1");
    await $`git -C ${env.repo} worktree add ${orphanPath} -b ORPHAN-1 origin/master`.quiet();

    // Simulate merge
    writeFileSync(join(orphanPath, "f.txt"), "f\n");
    await $`git -C ${orphanPath} add f.txt`.quiet();
    await $`git -C ${orphanPath} commit -m "ORPHAN-1 change"`.quiet();
    await $`git -C ${orphanPath} push -u origin ORPHAN-1`.quiet();
    await $`git -C ${env.repo} checkout master`.quiet();
    await $`git -C ${env.repo} merge ORPHAN-1 --no-ff -m "Pull request #99: ORPHAN-1"`.quiet();
    await $`git -C ${env.repo} push origin master`.quiet();

    await withTestEnv(env, () => cmdPrune([], env.repo));
    expect(existsSync(orphanPath)).toBe(false);
  });

  test("true orphan (worktree outside __worktrees) detected and removed", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    // Create a normal task so tasks.length > 0 (avoids early return)
    await withTestEnv(env, () => cmdStart(["PRUNE-REAL1"], env.repo));

    // Create a worktree outside __worktrees (git worktree list will find it but listTasks won't)
    const orphanPath = resolve(env.repo, "..", "orphan-true");
    await $`git -C ${env.repo} worktree add ${orphanPath} -b hotfix/ORPHAN-TRUE origin/master`.quiet();

    expect(existsSync(orphanPath)).toBe(true);
    await withTestEnv(env, () => cmdPrune([], env.repo));
    expect(existsSync(orphanPath)).toBe(false);
  });

  test("--ls shows orphaned section", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["PRUNE-LS2"], env.repo));

    // Create an orphan worktree outside __worktrees
    const orphanPath = resolve(env.repo, "..", "orphan-ls");
    await $`git -C ${env.repo} worktree add ${orphanPath} -b hotfix/ORPHAN-LS origin/master`.quiet();

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls"], env.repo)),
    );
    expect(stdout).toContain("Orphaned");
    expect(stdout).toContain("orphan-ls");
  });

  test("stale Jira detection marks tasks not found in Jira", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });
    writePluginsTs(env.home, ["jira"]);
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "jira-tok" } }),
    );

    await withTestEnv(env, () => cmdStart(["STALE-1"], env.repo));

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/myself")) {
        return new Response(JSON.stringify({ name: "u", displayName: "U" }), { status: 200 });
      }
      // Search returns empty — issue not found in Jira → stale
      if (url.includes("/search")) {
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls"], env.repo)),
    );
    globalThis.fetch = origFetch;

    expect(stdout).toContain("Stale");
    expect(stdout).toContain("STALE-1");
  });

  test("stale tasks pruned in non-ls mode", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });
    writePluginsTs(env.home, ["jira"]);
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "jira-tok" } }),
    );

    await withTestEnv(env, () => cmdStart(["STALEPRN-1"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "staleprn-1");
    expect(existsSync(wtPath)).toBe(true);

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/myself")) {
        return new Response(JSON.stringify({ name: "u", displayName: "U" }), { status: 200 });
      }
      if (url.includes("/search")) {
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune([], env.repo)),
    );
    globalThis.fetch = origFetch;

    expect(stdout).toContain("stale");
    expect(existsSync(wtPath)).toBe(false);
  });

  test("Jira unreachable skips stale detection", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });
    writePluginsTs(env.home, ["jira"]);
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "jira-tok" } }),
    );

    await withTestEnv(env, () => cmdStart(["JIRAUNR-1"], env.repo));

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as any;

    const { stderr } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls"], env.repo)),
    );
    globalThis.fetch = origFetch;

    expect(stderr).toContain("unavailable");
  });

  test("--ls --format=json includes stale and orphaned", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });
    writePluginsTs(env.home, ["jira"]);
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "jira-tok" } }),
    );

    await withTestEnv(env, () => cmdStart(["JSONLS-1"], env.repo));

    // Create orphan outside __worktrees
    const orphanPath = resolve(env.repo, "..", "orphan-json");
    await $`git -C ${env.repo} worktree add ${orphanPath} -b hotfix/ORPHAN-JSON origin/master`.quiet();

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/myself")) {
        return new Response(JSON.stringify({ name: "u", displayName: "U" }), { status: 200 });
      }
      if (url.includes("/search")) {
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdPrune(["--ls", "--format=json"], env.repo)),
    );
    globalThis.fetch = origFetch;

    const data = JSON.parse(stdout);
    expect(data.stale).toContain("JSONLS-1");
    expect(data.orphaned).toContain("orphan-json");
  });
});

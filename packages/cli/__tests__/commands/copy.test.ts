import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { $ } from "bun";
import { createTempRepo, writeWorkbenchJson, writeWorkbenchJson, withTestEnv } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdCopy } from "../../lib/commands/copy";
import { WbError } from "@stanok/core/utils";

describe("copy", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("copies files from copyFiles config to worktree", async () => {
    env = await createTempRepo();

    // Create a file to copy in repo
    writeFileSync(join(env.repo, ".npmrc"), "registry=https://registry.example.com\n");
    await $`git -C ${env.repo} add .npmrc && git -C ${env.repo} commit -m "add npmrc"`.quiet();

    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, {
      "copyFiles.include": [".npmrc"],
    });

    await withTestEnv(env, () => cmdStart(["COPY-1"], env.repo));

    // Delete the copied file to test re-copy
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "copy-1");
    rmSync(join(wtPath, ".npmrc"), { force: true });
    expect(existsSync(join(wtPath, ".npmrc"))).toBe(false);

    // Run copy from worktree context
    await withTestEnv(env, () => cmdCopy([], wtPath));
    expect(existsSync(join(wtPath, ".npmrc"))).toBe(true);
  });

  test("explicit taskId arg", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.repo, ".npmrc"), "registry=https://registry.example.com\n");
    await $`git -C ${env.repo} add .npmrc && git -C ${env.repo} commit -m "add npmrc"`.quiet();
    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, { "copyFiles.include": [".npmrc"] });

    await withTestEnv(env, () => cmdStart(["COPY-3"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "copy-3");
    rmSync(join(wtPath, ".npmrc"), { force: true });

    await withTestEnv(env, () => cmdCopy(["COPY-3"], env.repo));
    expect(existsSync(join(wtPath, ".npmrc"))).toBe(true);
  });

  test("no copyFiles config throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {}); // No copyFiles

    await withTestEnv(env, () => cmdStart(["COPY-4"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "copy-4");

    expect(
      withTestEnv(env, () => cmdCopy(["COPY-4"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("exclude pattern skips file", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.repo, "a.txt"), "a\n");
    writeFileSync(join(env.repo, "b.txt"), "b\n");
    await $`git -C ${env.repo} add -A && git -C ${env.repo} commit -m "add files"`.quiet();
    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, { "copyFiles.include": ["*.txt"], "copyFiles.exclude": ["b.txt"] });

    await withTestEnv(env, () => cmdStart(["COPY-5"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "copy-5");
    rmSync(join(wtPath, "a.txt"), { force: true });
    rmSync(join(wtPath, "b.txt"), { force: true });

    await withTestEnv(env, () => cmdCopy(["COPY-5"], env.repo));
    expect(existsSync(join(wtPath, "a.txt"))).toBe(true);
    expect(existsSync(join(wtPath, "b.txt"))).toBe(false);
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdCopy(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("not in git repo (no taskId) throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, { "copyFiles.include": ["*.txt"] });
    const tmpDir = join(require("os").tmpdir(), `wb-cnogit-${Date.now()}`);
    require("fs").mkdirSync(tmpDir, { recursive: true });

    try {
      await withTestEnv(env, () => cmdCopy([], tmpDir));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("Not inside a git repository");
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

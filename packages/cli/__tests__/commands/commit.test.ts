import { describe, expect, test, afterEach } from "bun:test";
import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { $ } from "bun";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdCommit } from "../../lib/commands/commit";
import { WbError } from "@stanok/core/utils";

describe("c (commit)", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("commits with task ID prefix from branch name", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["CMT-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "cmt-1");
    writeFileSync(join(wtPath, "test.txt"), "hello\n");
    await $`git -C ${wtPath} add test.txt`.quiet();

    const exitCode = await withTestEnv(env, () => cmdCommit(["Fix something"], wtPath));
    expect(exitCode).toBe(0);

    const log = (await $`git -C ${wtPath} log -1 --format=%s`.quiet()).text().trim();
    expect(log).toBe("CMT-1 | Fix something");
  });

  test("no message throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdCommit([], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("commit outside feature branch uses message without prefix", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    writeFileSync(join(env.repo, "test.txt"), "hello\n");
    await $`git -C ${env.repo} add test.txt`.quiet();

    const exitCode = await withTestEnv(env, () => cmdCommit(["Direct commit"], env.repo));
    expect(exitCode).toBe(0);

    const log = (await $`git -C ${env.repo} log -1 --format=%s`.quiet()).text().trim();
    expect(log).toBe("Direct commit");
  });

  test("nothing to commit returns non-zero exit code", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["CMT-2"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "cmt-2");
    // Don't stage anything
    const exitCode = await withTestEnv(env, () => cmdCommit(["Empty commit"], wtPath));
    expect(exitCode).not.toBe(0);
  });
});

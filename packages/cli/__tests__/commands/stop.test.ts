import { describe, expect, test, afterEach } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdStop } from "../../lib/commands/stop";
import { WbError } from "@stanok/core/utils";

describe("stop", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("stop without --remove preserves worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["TEST-50"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdStop(["TEST-50"], env.repo)),
    );

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "test-50");
    expect(existsSync(wtPath)).toBe(true);
    expect(stdout).toContain("preserved");
  });

  test("stop --remove deletes worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["TEST-51"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "test-51");
    expect(existsSync(wtPath)).toBe(true);

    await withTestEnv(env, () => cmdStop(["TEST-51", "--remove"], env.repo));
    expect(existsSync(wtPath)).toBe(false);
  });

  test("stop nonexistent task throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdStop(["NONEXIST-1"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("no task ID throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStop([], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStop(["TEST-52", "--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

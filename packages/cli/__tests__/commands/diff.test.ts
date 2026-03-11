import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdDiff } from "../../lib/commands/diff";
import { WbError } from "@stanok/core/utils";

describe("diff", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("throws when no task ID given and not in worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdDiff([], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("throws when task doesn't exist", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdDiff(["NONEXIST-99"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("runs diff for existing worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["DIFF-1"], env.repo));

    // Should not throw
    await captureOutput(() =>
      withTestEnv(env, () => cmdDiff(["DIFF-1"], env.repo)),
    );
  });

  test("--stat flag accepted", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["DIFF-2"], env.repo));

    await captureOutput(() =>
      withTestEnv(env, () => cmdDiff(["DIFF-2", "--stat"], env.repo)),
    );
  });
});

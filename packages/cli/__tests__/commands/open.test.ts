import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdOpen } from "../../lib/commands/open";
import { WbError } from "@stanok/core/utils";

describe("open", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("throws when no task ID given and not in worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    // Run from repo root (on master branch, no task ID detectable)
    expect(
      withTestEnv(env, () => cmdOpen([], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("throws when task doesn't exist", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdOpen(["NONEXIST-99"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("opens existing worktree (SK_TEST skips actual open)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["OPEN-1"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdOpen(["OPEN-1"], env.repo)),
    );
    expect(stdout).toContain("Opened");
  });

  test("--terminal flag accepted", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["OPEN-2"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdOpen(["OPEN-2", "--terminal"], env.repo)),
    );
    // In SK_TEST mode, returns early without actually opening
    // No error means success
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdOpen(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

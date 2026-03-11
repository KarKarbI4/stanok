import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, wb, writeWorkbenchJson, withTestEnv } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdRun } from "../../lib/commands/run";
import { WbError } from "@stanok/core/utils";

describe("run", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("executes command in worktree context", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["RUN-1"], env.repo));

    // cmdRun inherits stdout, so use E2E helper for output check
    const result = await wb(env, "run", "RUN-1", "pwd");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toEndWith("/run-1");
  });

  test("too few args throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdRun(["RUN-2"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("worktree not found throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdRun(["NONEXIST-1", "pwd"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("non-zero exit code returned", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["RUN-3"], env.repo));

    const result = await wb(env, "run", "RUN-3", "exit 42");
    expect(result.exitCode).toBe(42);
  });

  test("runs command in worktree context (direct)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["RUN-4"], env.repo));

    const exitCode = await withTestEnv(env, () => cmdRun(["RUN-4", "true"], env.repo));
    expect(exitCode).toBe(0);
  });
});

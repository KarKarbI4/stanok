import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdList } from "../../lib/commands/list";
import { WbError } from "@stanok/core/utils";

describe("ls", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("empty repo shows header but no tasks", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList([], env.repo)),
    );
    expect(stdout).toContain("TASK");
    expect(stdout).toContain("no registered worktrees");
  });

  test("with worktree shows task in output", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["LIST-1"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList([], env.repo)),
    );
    expect(stdout).toContain("LIST-1");
  });

  test("table shows TASK, BRANCH, AGE, ENV columns", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList([], env.repo)),
    );
    expect(stdout).toContain("TASK");
    expect(stdout).toContain("BRANCH");
    expect(stdout).toContain("AGE");
    expect(stdout).toContain("ENV");
  });

  test("--format=json returns valid JSON array", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["LIST-2"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=json"], env.repo)),
    );

    const tasks = JSON.parse(stdout);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].task_id).toBe("LIST-2");
  });

  test("--format=json works without tracker (no summary/status)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["LIST-6"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=json"], env.repo)),
    );

    const tasks = JSON.parse(stdout);
    const task = tasks.find((t: any) => t.task_id === "LIST-6");
    expect(task).toBeDefined();
    expect(task.summary).toBeUndefined();
    expect(task.status).toBeUndefined();
  });

  test("--format=ids returns one ID per line", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["LIST-3"], env.repo));

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdList(["--format=ids"], env.repo)),
    );
    const lines = stdout.trim().split("\n");
    expect(lines).toContain("LIST-3");
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdList(["--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

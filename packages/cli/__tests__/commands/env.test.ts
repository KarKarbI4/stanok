import { describe, expect, test, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdEnv } from "../../lib/commands/env";
import { WbError } from "@stanok/core/utils";

describe("env", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("without args shows current env from worktree", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["ENV-1", "--env=STAND=dev1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "env-1");
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdEnv([], wtPath)),
    );
    expect(stdout).toContain("STAND=dev1");
  });

  test("with KEY=VALUE updates env file", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["ENV-2"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "env-2");
    await withTestEnv(env, () => cmdEnv(["API_URL=http://localhost:3000"], wtPath));

    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("API_URL=http://localhost:3000");
  });

  test("invalid KEY (no =) throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["ENV-3"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "env-3");
    expect(
      withTestEnv(env, () => cmdEnv(["NOEQUALS"], wtPath)),
    ).rejects.toThrow(WbError);
  });

  test("empty env display shows (no env vars set)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["ENV-4"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "env-4");
    // Remove env file if it was created
    const { rmSync } = await import("fs");
    rmSync(join(wtPath, ".env.development.local"), { force: true });

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdEnv([], wtPath)),
    );
    expect(stdout).toContain("no env vars set");
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["ENV-5"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "env-5");
    expect(
      withTestEnv(env, () => cmdEnv(["--bogus"], wtPath)),
    ).rejects.toThrow(WbError);
  });

  test("not in git repo throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const tmpDir = join(require("os").tmpdir(), `wb-nogit-${Date.now()}`);
    require("fs").mkdirSync(tmpDir, { recursive: true });

    try {
      await withTestEnv(env, () => cmdEnv([], tmpDir));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
      expect((e as WbError).message).toContain("Not inside a git repository");
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

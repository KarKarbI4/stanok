import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempRepo, writeWorkbenchJson, writeWbConfig, writeWbState, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { WbError } from "@stanok/core/utils";

describe("start", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("creates worktree with correct branch and directory", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["TEST-42"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "test-42");
    expect(existsSync(wtPath)).toBe(true);

    const { $ } = await import("bun");
    const branch = (await $`git -C ${wtPath} rev-parse --abbrev-ref HEAD`.quiet()).text().trim();
    expect(branch).toBe("TEST-42");
  });

  test("repeat start on existing worktree doesn't fail", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["TEST-43"], env.repo));
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdStart(["TEST-43"], env.repo)),
    );
    expect(stdout).toContain("already exists");
  });

  test("--env KEY=VALUE sets env in .env.development.local", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["TEST-44", "--env=STAND=dev5"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "test-44");
    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("STAND=dev5");
  });

  test("unknown flag throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStart(["TEST-45", "--bogus"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("no task ID throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStart([], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("custom branchTemplate from settings.json", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { branchTemplate: "fix/{task}" });

    await withTestEnv(env, () => cmdStart(["BUG-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "bug-1");
    const { $ } = await import("bun");
    const branch = (await $`git -C ${wtPath} rev-parse --abbrev-ref HEAD`.quiet()).text().trim();
    expect(branch).toBe("fix/BUG-1");
  });

  test("--env KEY=VALUE (space form)", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    await withTestEnv(env, () => cmdStart(["TEST-46", "--env", "API=http://localhost"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "test-46");
    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("API=http://localhost");
  });

  test("--env without value throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStart(["TEST-47", "--env"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("--env=KEY (no =VALUE) throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdStart(["TEST-48", "--env=NOVALUE"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("existing branch uses worktree add without -b", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const { $ } = await import("bun");

    // Create the branch first (default template = bare task ID)
    await $`git -C ${env.repo} branch EXIST-1 origin/master`.quiet();

    await withTestEnv(env, () => cmdStart(["EXIST-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "exist-1");
    expect(existsSync(wtPath)).toBe(true);
    const branch = (await $`git -C ${wtPath} rev-parse --abbrev-ref HEAD`.quiet()).text().trim();
    expect(branch).toBe("EXIST-1");
  });

  test("copyFiles during start", async () => {
    env = await createTempRepo();
    const { $ } = await import("bun");
    writeFileSync(join(env.repo, ".npmrc"), "registry=https://test\n");
    await $`git -C ${env.repo} add .npmrc && git -C ${env.repo} commit -m "add npmrc"`.quiet();
    writeWorkbenchJson(env.repo, { "copyFiles.include": [".npmrc"] });

    await withTestEnv(env, () => cmdStart(["CPSTART-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "cpstart-1");
    expect(existsSync(join(wtPath, ".npmrc"))).toBe(true);
  });

  test("last_stand fallback", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWbState(env.home, { repos: [env.repo], last_stand: "dev99" });

    await withTestEnv(env, () => cmdStart(["STAND-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "stand-1");
    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("STAND=dev99");
  });

  test("repo_env inheritance", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWbState(env.home, {
      repos: [env.repo],
      repo_env: { [env.repo]: { CUSTOM: "val" } },
    });

    await withTestEnv(env, () => cmdStart(["RENV-1"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "renv-1");
    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("CUSTOM=val");
  });

  test("existing .env.development.local is read rather than defaults", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWbState(env.home, {
      repos: [env.repo],
      repo_env: { [env.repo]: { DEFAULT: "should-not-appear" } },
    });

    // First create the worktree
    await withTestEnv(env, () => cmdStart(["EENV-1"], env.repo));
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "eenv-1");
    // Write custom .env
    writeFileSync(join(wtPath, ".env.development.local"), "EXISTING=yes\n");

    // Second start should read existing file
    await withTestEnv(env, () => cmdStart(["EENV-1"], env.repo));
    const envContent = readFileSync(join(wtPath, ".env.development.local"), "utf-8");
    expect(envContent).toContain("EXISTING=yes");
  });

  test("custom envFile in config", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { envFile: ".env.local" });

    await withTestEnv(env, () => cmdStart(["ENVF-1", "--env=FOO=bar"], env.repo));

    const wtPath = resolve(env.repo, "..", "repo__worktrees", "envf-1");
    expect(existsSync(join(wtPath, ".env.local"))).toBe(true);
    const envContent = readFileSync(join(wtPath, ".env.local"), "utf-8");
    expect(envContent).toContain("FOO=bar");
  });

  test("summary does not include URL line", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdStart(["NOURL-1"], env.repo)),
    );
    expect(stdout).not.toContain("URL:");
  });
});

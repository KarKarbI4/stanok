import { describe, expect, test, afterEach } from "bun:test";
import { join } from "path";
import { createTempRepo, writeWorkbenchJson, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdConfig } from "../../lib/commands/config-cmd";

describe("config", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("outputs JSON with merged config from repo", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, { baseBranch: "main" });

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdConfig(env.repo)),
    );

    const config = JSON.parse(stdout);
    expect(config.repo).toBe(env.repo);
    expect(config.baseBranch).toBe("main");
    expect(config.branchTemplate).toBe("{task}");
  });

  test("includes default values when no project config", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdConfig(env.repo)),
    );

    const config = JSON.parse(stdout);
    expect(config.repo).toBe(env.repo);
    expect(config.baseBranch).toBe("master");
    expect(config.proxyPort).toBe(1355);
  });

  test("no repo found — all values null in JSON", async () => {
    env = await createTempRepo();
    const { writeWbState } = await import("../helpers");
    writeWbState(env.home, { repos: [] });

    const tmpDir = join(require("os").tmpdir(), `wb-nocfg-${Date.now()}`);
    require("fs").mkdirSync(tmpDir, { recursive: true });

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdConfig(tmpDir)),
    );

    const config = JSON.parse(stdout);
    expect(config.repo).toBeNull();
    expect(config.baseBranch).toBeNull();
    require("fs").rmSync(tmpDir, { recursive: true, force: true });
  });

  test("hooks from project and personal config merged", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    writeWorkbenchJson(env.repo, { "hooks.postCreate": ["echo project"] });
    const { writeWbConfig } = await import("../helpers");
    writeWbConfig(env.home, {
      "hooks.postCreate": ["echo personal"],
    });

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdConfig(env.repo)),
    );

    const config = JSON.parse(stdout);
    expect(config.hooks.postCreate).toContain("echo project");
    expect(config.hooks.postCreate).toContain("echo personal");
  });
});

import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, writeWorkbenchJson, writeWbConfig, withTestEnv, captureOutput } from "../helpers";
import { cmdDoctor } from "../../lib/commands/doctor";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/** Run doctor and reset process.exitCode so it doesn't leak into the test runner. */
async function runDoctor() {
  await cmdDoctor();
  process.exitCode = 0;
}

describe("doctor", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("reports all checks", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toContain("Stanok doctor");
    expect(stdout).toContain("git");
    expect(stdout).toContain("bun");
  });

  test("git check passes", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ git/);
  });

  test("bun check passes", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ bun/);
  });

  test("~/.stanok/ check passes when exists", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ ~\/.stanok\//);
  });

  test("plugins.ts check fails when missing", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✗ plugins.ts/);
  });

  test("plugins.ts check passes when present", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "plugins.ts"), "export const plugins = [];");

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ plugins.ts/);
  });

  test("auth.json check fails when missing", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✗ auth.json/);
  });

  test("auth.json check passes when present with tokens", async () => {
    env = await createTempRepo();
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "abc" } }),
    );

    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ auth.json/);
  });

  test("repos check passes when registered", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => runDoctor()),
    );
    expect(stdout).toMatch(/✓ repos/);
    expect(stdout).toContain("1 registered");
  });
});

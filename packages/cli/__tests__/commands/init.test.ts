import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, writeFileSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import { createTempRepo, wbAt, writeWbState } from "../helpers";

describe("init", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("registers repo in state.json", async () => {
    env = await createTempRepo();

    // Create a new repo to init (separate from the test repo)
    const rawNewRepo = join(tmpdir(), `wb-init-${Date.now()}`);
    mkdirSync(rawNewRepo, { recursive: true });
    const newRepo = realpathSync(rawNewRepo);
    await $`git init ${newRepo}`.quiet();
    await $`git -C ${newRepo} config user.email "test@test.com"`.quiet();
    await $`git -C ${newRepo} config user.name "Test"`.quiet();
    writeFileSync(join(newRepo, "README.md"), "# Init test\n");
    await $`git -C ${newRepo} add . && git -C ${newRepo} commit -m "init"`.quiet();

    // Write existing state with settings.json in new repo so init doesn't prompt
    writeWbState(env.home, { repos: [] });
    mkdirSync(join(newRepo, ".stanok"), { recursive: true });
    writeFileSync(join(newRepo, ".stanok", "settings.json"), "{}");

    const result = await wbAt(env, newRepo, "init");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Registered repo");

    // Verify it's in state
    const state = JSON.parse(readFileSync(join(env.home, ".stanok", "state.json"), "utf-8"));
    expect(state.repos).toContain(newRepo);
  });

  test("non-git directory exits with error", async () => {
    env = await createTempRepo();
    const notGit = join(tmpdir(), `wb-notgit-${Date.now()}`);
    mkdirSync(notGit, { recursive: true });

    const result = await wbAt(env, notGit, "init");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a git repository");
  });

  test("already registered repo is idempotent", async () => {
    env = await createTempRepo();
    mkdirSync(join(env.repo, ".stanok"), { recursive: true });
    writeFileSync(join(env.repo, ".stanok", "settings.json"), "{}");

    // Init same repo twice
    const result1 = await wbAt(env, env.repo, "init");
    expect(result1.exitCode).toBe(0);

    const result2 = await wbAt(env, env.repo, "init");
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain("Registered repo");

    // Verify state has repo only once
    const state = JSON.parse(readFileSync(join(env.home, ".stanok", "state.json"), "utf-8"));
    const count = state.repos.filter((r: string) => r === env.repo).length;
    expect(count).toBe(1);
  });
});

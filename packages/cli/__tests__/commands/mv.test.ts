import { describe, expect, test, afterEach } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";
import { $ } from "bun";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";
import { cmdStart } from "../../lib/commands/start";
import { cmdMv } from "../../lib/commands/mv";
import { WbError } from "@stanok/core/utils";

describe("mv", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  test("renames task: old path gone, new path exists, branch renamed", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["MV-1"], env.repo));

    await withTestEnv(env, () => cmdMv(["MV-1", "MV-2"], env.repo));

    const oldPath = resolve(env.repo, "..", "repo__worktrees", "mv-1");
    const newPath = resolve(env.repo, "..", "repo__worktrees", "mv-2");
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);

    const branch = (await $`git -C ${newPath} rev-parse --abbrev-ref HEAD`.quiet()).text().trim();
    expect(branch).toBe("MV-2");
  });

  test("requires exactly 2 args", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdMv(["ONLY-ONE"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("source missing throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    expect(
      withTestEnv(env, () => cmdMv(["NONEXIST-1", "NEW-1"], env.repo)),
    ).rejects.toThrow(WbError);
  });

  test("target exists throws WbError", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    await withTestEnv(env, () => cmdStart(["MV-A"], env.repo));
    await withTestEnv(env, () => cmdStart(["MV-B"], env.repo));

    expect(
      withTestEnv(env, () => cmdMv(["MV-A", "MV-B"], env.repo)),
    ).rejects.toThrow(WbError);
  });
});

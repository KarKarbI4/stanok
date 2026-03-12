import { describe, expect, test, afterEach } from "bun:test";
import { createTempRepo, withTestEnv, captureOutput } from "../helpers";
import { cmdCompletions } from "../../lib/commands/completions";
import { COMMANDS, ALIASES } from "../../lib/commands";
import { WbError } from "@stanok/core/utils";

describe("completions", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;

  afterEach(() => env?.cleanup());

  // ── zsh ──

  test("zsh: generates completion script with key commands", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["zsh"])),
    );
    expect(stdout).toContain("compdef");
    expect(stdout).toContain("start:");
    expect(stdout).toContain("stop:");
    expect(stdout).toContain("ls:");
    expect(stdout).toContain("pr:");
  });

  test("zsh: registers stanok", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["zsh"])),
    );
    expect(stdout).toContain("compdef _stanok stanok");
  });

  test("zsh: includes task ID completion function", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["zsh"])),
    );
    expect(stdout).toContain("_stanok_task_ids");
    expect(stdout).toContain("stanok ls --format=ids");
  });

  // ── bash ──

  test("bash: generates completion script with key commands", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["bash"])),
    );
    expect(stdout).toContain("complete -F _stanok stanok");
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("ls");
    expect(stdout).toContain("pr");
  });

  test("bash: includes task ID completion", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["bash"])),
    );
    expect(stdout).toContain("stanok ls --format=ids");
  });

  test("bash: includes subcommand flags", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["bash"])),
    );
    expect(stdout).toContain("--remove");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--build");
  });

  // ── fish ──

  test("fish: generates completion script with key commands", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["fish"])),
    );
    expect(stdout).toContain("complete -c stanok");
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("ls");
    expect(stdout).toContain("pr");
  });

  test("fish: disables file completions", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["fish"])),
    );
    expect(stdout).toContain("complete -c stanok -f");
  });

  test("fish: includes task ID completion", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["fish"])),
    );
    expect(stdout).toContain("stanok ls --format=ids");
  });

  test("fish: includes subcommand flags", async () => {
    env = await createTempRepo();
    const { stdout } = await captureOutput(() =>
      withTestEnv(env, () => cmdCompletions(["fish"])),
    );
    expect(stdout).toContain("-l 'remove'");
    expect(stdout).toContain("-l 'dry-run'");
    expect(stdout).toContain("-l 'build'");
  });

  // ── sync with stanok.ts ──

  test("every switch case in stanok.ts has a COMMANDS entry (or is an alias)", async () => {
    const src = await Bun.file(import.meta.dir + "/../../stanok.ts").text();
    const cases = [...src.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
    const commandKeys = new Set(Object.values(COMMANDS).flatMap((g) => Object.keys(g)));
    const aliasKeys = new Set(Object.keys(ALIASES));

    for (const c of cases) {
      expect(commandKeys.has(c) || aliasKeys.has(c)).toBe(true);
    }
  });

  test("every COMMANDS entry has a switch case in stanok.ts", async () => {
    const src = await Bun.file(import.meta.dir + "/../../stanok.ts").text();
    const cases = new Set([...src.matchAll(/case "(\w+)":/g)].map((m) => m[1]));
    const commandKeys = Object.values(COMMANDS).flatMap((g) => Object.keys(g));

    for (const cmd of commandKeys) {
      expect(cases.has(cmd)).toBe(true);
    }
  });

  // ── errors ──

  test("unknown shell throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdCompletions(["powershell"])),
    ).rejects.toThrow(WbError);
  });

  test("no args throws WbError", async () => {
    env = await createTempRepo();
    expect(
      withTestEnv(env, () => cmdCompletions([])),
    ).rejects.toThrow(WbError);
  });
});

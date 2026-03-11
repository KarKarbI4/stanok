import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  WbError,
  info,
  requireRepo,
  tokenHint,
  currentBranch,
  taskIdFromBranch,
  hookEnv,
  runHooks,
  copyFilesFromRepo,
  writeEnvFile,
  formatEnv,
} from "../utils";
import { createTempRepo, withTestEnv, captureOutput, writeWbState } from "../../__tests__/helpers";

describe("WbError", () => {
  test("constructor sets name to WbError", () => {
    const err = new WbError("test message");
    expect(err.name).toBe("WbError");
    expect(err.message).toBe("test message");
  });

  test("is instanceof Error", () => {
    const err = new WbError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("info", () => {
  test("outputs → prefix", async () => {
    const { stdout } = await captureOutput(async () => {
      info("hello world");
    });
    expect(stdout).toContain("→ hello world");
  });
});

describe("requireRepo", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("detected repo returns it", async () => {
    env = await createTempRepo();
    const repo = await withTestEnv(env, () => requireRepo(env.repo));
    expect(repo).toBe(env.repo);
  });

  test("no git repo throws WbError", async () => {
    env = await createTempRepo();
    const tmpDir = join(tmpdir(), `wb-req-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      await withTestEnv(env, () => requireRepo(tmpDir));
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WbError);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("tokenHint", () => {
  test("Bitbucket hint contains access-tokens", () => {
    const hint = tokenHint("Bitbucket", "https://bb.example.com");
    expect(hint).toContain("access-tokens");
  });

  test("Jira hint contains ViewProfile", () => {
    const hint = tokenHint("Jira", "https://jira.example.com/");
    expect(hint).toContain("ViewProfile");
  });

  test("Bamboo hint contains userAccessTokens", () => {
    const hint = tokenHint("Bamboo", "https://bamboo.example.com");
    expect(hint).toContain("userAccessTokens");
  });

  test("unknown label returns empty string", () => {
    expect(tokenHint("Other", "https://example.com")).toBe("");
  });

  test("trailing slash in URL is stripped", () => {
    const hint = tokenHint("Bitbucket", "https://bb.example.com///");
    expect(hint).toContain("https://bb.example.com/plugins");
  });
});

describe("currentBranch", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("returns branch from git repo", async () => {
    env = await createTempRepo();
    const branch = await currentBranch(env.repo);
    expect(branch).toBe("master");
  });
});

describe("taskIdFromBranch", () => {
  test("extracts task ID with feature template", () => {
    expect(taskIdFromBranch("feature/MP3UI-1811", "feature/{task}")).toBe("MP3UI-1811");
  });

  test("returns null when template prefix doesn't match", () => {
    expect(taskIdFromBranch("main", "feature/{task}")).toBeNull();
  });

  test("bare template matches task-ID-like branches", () => {
    expect(taskIdFromBranch("MP3UI-1811", "{task}")).toBe("MP3UI-1811");
  });

  test("bare template rejects non-task branches", () => {
    expect(taskIdFromBranch("master", "{task}")).toBeNull();
    expect(taskIdFromBranch("main", "{task}")).toBeNull();
    expect(taskIdFromBranch("develop", "{task}")).toBeNull();
  });

  test("default template is bare {task}", () => {
    expect(taskIdFromBranch("MP3UI-1811")).toBe("MP3UI-1811");
    expect(taskIdFromBranch("master")).toBeNull();
  });

  test("template with suffix", () => {
    expect(taskIdFromBranch("feature/MP3UI-1811/wip", "feature/{task}/wip")).toBe("MP3UI-1811");
  });

  test("no {task} in template returns null", () => {
    expect(taskIdFromBranch("anything", "static-branch")).toBeNull();
  });

  test("empty branch part returns null", () => {
    expect(taskIdFromBranch("feature/", "feature/{task}")).toBeNull();
  });
});

describe("hookEnv", () => {
  test("returns expected keys", () => {
    const result = hookEnv("TASK-1", "feature/TASK-1", { STAND: "dev1" }, "/repo", "/wt");
    expect(result.TASK_ID).toBe("TASK-1");
    expect(result.BRANCH).toBe("feature/TASK-1");
    expect(result.STAND).toBe("dev1");
    expect(result.REPO_PATH).toBe("/repo");
    expect(result.WORKTREE_PATH).toBe("/wt");
  });
});

describe("runHooks", () => {
  test("empty hooks is noop", async () => {
    const { stdout } = await captureOutput(async () => {
      await runHooks("test", undefined, {}, "/tmp");
    });
    expect(stdout).toBe("");
  });

  test("empty array is noop", async () => {
    const { stdout } = await captureOutput(async () => {
      await runHooks("test", [], {}, "/tmp");
    });
    expect(stdout).toBe("");
  });

  test("valid command runs", async () => {
    const tmpDir = join(tmpdir(), `wb-hook-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await runHooks("test", ["echo hook-ran"], {}, tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("failing command logs error and continues", async () => {
    const tmpDir = join(tmpdir(), `wb-hook2-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const { stderr } = await captureOutput(async () => {
      await runHooks("test", ["false", "echo still-running"], {}, tmpDir);
    });
    expect(stderr).toContain("failed");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("copyFilesFromRepo", () => {
  test("copies matched files", async () => {
    const base = join(tmpdir(), `wb-copy-${Date.now()}`);
    const src = join(base, "src");
    const dst = join(base, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(src, ".npmrc"), "test");
    writeFileSync(join(src, "other.txt"), "other");

    const copied = await copyFilesFromRepo(src, dst, { include: [".npmrc"] });
    expect(copied).toEqual([".npmrc"]);
    expect(existsSync(join(dst, ".npmrc"))).toBe(true);
    expect(existsSync(join(dst, "other.txt"))).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });

  test("exclude skips matched files", async () => {
    const base = join(tmpdir(), `wb-copy2-${Date.now()}`);
    const src = join(base, "src");
    const dst = join(base, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(src, "a.txt"), "a");
    writeFileSync(join(src, "b.txt"), "b");

    const copied = await copyFilesFromRepo(src, dst, {
      include: ["*.txt"],
      exclude: ["b.txt"],
    });
    expect(copied).toContain("a.txt");
    expect(copied).not.toContain("b.txt");
    rmSync(base, { recursive: true, force: true });
  });

  test("empty include returns empty", async () => {
    const base = join(tmpdir(), `wb-copy3-${Date.now()}`);
    const src = join(base, "src");
    const dst = join(base, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });

    const copied = await copyFilesFromRepo(src, dst, { include: [] });
    expect(copied).toEqual([]);
    rmSync(base, { recursive: true, force: true });
  });
});

describe("writeEnvFile", () => {
  test("writes KEY=VALUE lines", () => {
    const tmpDir = join(tmpdir(), `wb-env-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeEnvFile(tmpDir, { STAND: "dev1", API: "http://localhost" });
    const content = require("fs").readFileSync(join(tmpDir, ".env.development.local"), "utf-8");
    expect(content).toContain("STAND=dev1");
    expect(content).toContain("API=http://localhost");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("formatEnv", () => {
  test("empty object returns dash", () => {
    expect(formatEnv({})).toBe("-");
  });

  test("formats KEY=VALUE pairs", () => {
    const result = formatEnv({ A: "1", B: "2" });
    expect(result).toBe("A=1 B=2");
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveWorkbenchConfig,
  parseBitbucketRepo,
  detectPackageManager,
  projectSlug,
  findProjectRoot,
  loadWorkbenchJson,
} from "../project";

describe("resolveWorkbenchConfig", () => {
  test("returns defaults for empty config", () => {
    const result = resolveWorkbenchConfig({});
    expect(result.baseBranch).toBe("master");
    expect(result.branchTemplate).toBe("{task}");
    expect(result.proxyPort).toBe(1355);
    expect(result.mergeDetection).toBe("Pull request");
    expect(result.envFile).toBe(".env.development.local");
  });

  test("merges partial overrides", () => {
    const result = resolveWorkbenchConfig({ baseBranch: "main", branchTemplate: "fix/{task}" });
    expect(result.baseBranch).toBe("main");
    expect(result.branchTemplate).toBe("fix/{task}");
    // Defaults preserved
    expect(result.proxyPort).toBe(1355);
    expect(result.mergeDetection).toBe("Pull request");
  });

  test("full override", () => {
    const result = resolveWorkbenchConfig({
      baseBranch: "develop",
      branchTemplate: "task/{task}",
      proxyPort: 9999,
      mergeDetection: "Merge commit",
    });
    expect(result.baseBranch).toBe("develop");
    expect(result.branchTemplate).toBe("task/{task}");
    expect(result.proxyPort).toBe(9999);
    expect(result.mergeDetection).toBe("Merge commit");
  });

  test("packageManager auto triggers detectPackageManager", () => {
    const tmpDir = join(tmpdir(), `wb-pm-auto-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "bun.lockb"), "");
    const result = resolveWorkbenchConfig({ packageManager: "auto" } as any, tmpDir);
    expect((result as any).packageManager).toBe("bun");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("parseBitbucketRepo", () => {
  test("valid format", () => {
    const result = parseBitbucketRepo("projects/UI/repos/general_mp3");
    expect(result).toEqual({ project: "UI", repo: "general_mp3" });
  });

  test("valid format with nested repo name", () => {
    const result = parseBitbucketRepo("projects/BACKEND/repos/api-gateway");
    expect(result).toEqual({ project: "BACKEND", repo: "api-gateway" });
  });

  test("invalid format — no projects prefix", () => {
    expect(parseBitbucketRepo("UI/general_mp3")).toBeNull();
  });

  test("invalid format — missing repos", () => {
    expect(parseBitbucketRepo("projects/UI/general_mp3")).toBeNull();
  });

  test("invalid format — empty string", () => {
    expect(parseBitbucketRepo("")).toBeNull();
  });
});

describe("detectPackageManager", () => {
  let tmpDir: string;

  test("detects bun from bun.lockb", () => {
    tmpDir = join(tmpdir(), `wb-pm-${Date.now()}-1`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "bun.lockb"), "");
    expect(detectPackageManager(tmpDir)).toBe("bun");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects bun from bun.lock", () => {
    tmpDir = join(tmpdir(), `wb-pm-${Date.now()}-2`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "bun.lock"), "");
    expect(detectPackageManager(tmpDir)).toBe("bun");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects pnpm", () => {
    tmpDir = join(tmpdir(), `wb-pm-${Date.now()}-3`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmpDir)).toBe("pnpm");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects yarn", () => {
    tmpDir = join(tmpdir(), `wb-pm-${Date.now()}-4`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "yarn.lock"), "");
    expect(detectPackageManager(tmpDir)).toBe("yarn");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("defaults to npm", () => {
    tmpDir = join(tmpdir(), `wb-pm-${Date.now()}-5`);
    mkdirSync(tmpDir, { recursive: true });
    expect(detectPackageManager(tmpDir)).toBe("npm");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("projectSlug", () => {
  test("returns basename of path", () => {
    expect(projectSlug("/home/user/projects/my-app")).toBe("my-app");
  });

  test("handles root-level dirs", () => {
    expect(projectSlug("/repo")).toBe("repo");
  });
});

describe("findProjectRoot", () => {
  test("finds .stanok/settings.json in directory", () => {
    const tmpDir = join(tmpdir(), `wb-fpr-${Date.now()}`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.json"), "{}");
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null when no settings found", () => {
    const tmpDir = join(tmpdir(), `wb-fpr-empty-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    expect(findProjectRoot(tmpDir)).toBeNull();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("traverses to parent directory", () => {
    const tmpDir = join(tmpdir(), `wb-fpr-parent-${Date.now()}`);
    const child = join(tmpDir, "sub", "deep");
    mkdirSync(child, { recursive: true });
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.json"), "{}");
    expect(findProjectRoot(child)).toBe(tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("finds project by settings.local.json only", () => {
    const tmpDir = join(tmpdir(), `wb-fpr-local-${Date.now()}`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.local.json"), '{"jira.url":"https://example.com"}');
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("loadWorkbenchJson", () => {
  test("loads base config only", () => {
    const tmpDir = join(tmpdir(), `wb-lwj-${Date.now()}`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.json"), '{"baseBranch":"main"}');
    expect(loadWorkbenchJson(tmpDir)).toEqual({ baseBranch: "main" });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("local overrides base", () => {
    const tmpDir = join(tmpdir(), `wb-lwj-merge-${Date.now()}`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.json"), '{"baseBranch":"main","branchTemplate":"feature/{task}"}');
    writeFileSync(join(tmpDir, ".stanok", "settings.local.json"), '{"baseBranch":"develop","jira.url":"https://jira.test"}');
    const result = loadWorkbenchJson(tmpDir);
    expect(result.baseBranch).toBe("develop");
    expect(result.branchTemplate).toBe("feature/{task}");
    expect((result as any)["jira.url"]).toBe("https://jira.test");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("local-only without base config", () => {
    const tmpDir = join(tmpdir(), `wb-lwj-local-${Date.now()}`);
    mkdirSync(join(tmpDir, ".stanok"), { recursive: true });
    writeFileSync(join(tmpDir, ".stanok", "settings.local.json"), '{"jira.url":"https://jira.test"}');
    expect(loadWorkbenchJson(tmpDir)).toEqual({ "jira.url": "https://jira.test" });
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

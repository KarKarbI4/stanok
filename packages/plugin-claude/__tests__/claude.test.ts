import { describe, expect, test, afterEach } from "bun:test";
import { claude } from "../index";
import { bindPlugin, type PluginContext } from "@stanok/core/plugin";
import { existsSync, mkdirSync, rmSync, readlinkSync, realpathSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("claude plugin", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  function makeTempDir(): string {
    const raw = join(tmpdir(), `claude-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(raw, { recursive: true });
    tempDir = realpathSync(raw);
    return tempDir;
  }

  test("has correct name", () => {
    expect(claude.name).toBe("claude");
  });

  test("has empty settings", () => {
    expect(claude.settings).toEqual({});
  });

  test("defines postCreate hook", () => {
    expect(claude.postCreate).toBeDefined();
    expect(typeof claude.postCreate).toBe("function");
  });

  test("postCreate symlinks settings.local.json when source exists", async () => {
    const base = makeTempDir();
    const repo = join(base, "repo");
    const wt = join(base, "wt");
    const home = join(base, "home");

    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "settings.local.json"), "{}");
    mkdirSync(wt, { recursive: true });

    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const ctx: PluginContext = {
        taskId: "TEST-1",
        branch: "feature/TEST-1",
        env: {},
        repo,
        wtPath: wt,
      };
      await claude.postCreate!(ctx, {});

      const target = join(wt, ".claude", "settings.local.json");
      expect(existsSync(target)).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("postCreate creates memory symlink", async () => {
    const base = makeTempDir();
    const repo = join(base, "repo");
    const wt = join(base, "wt");
    const home = join(base, "home");

    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const ctx: PluginContext = {
        taskId: "TEST-1",
        branch: "feature/TEST-1",
        env: {},
        repo,
        wtPath: wt,
      };
      await claude.postCreate!(ctx, {});

      const toProjectId = (p: string) => p.replace(/\//g, "-");
      const wtMemory = join(home, ".claude", "projects", toProjectId(wt), "memory");
      expect(existsSync(wtMemory)).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("postCreate does not re-create existing symlink", async () => {
    const base = makeTempDir();
    const repo = join(base, "repo");
    const wt = join(base, "wt");
    const home = join(base, "home");

    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    const toProjectId = (p: string) => p.replace(/\//g, "-");
    const repoMemory = join(home, ".claude", "projects", toProjectId(repo), "memory");
    const wtProjectDir = join(home, ".claude", "projects", toProjectId(wt));
    const wtMemory = join(wtProjectDir, "memory");

    mkdirSync(repoMemory, { recursive: true });
    mkdirSync(wtProjectDir, { recursive: true });
    // Create the symlink manually first
    const { execSync } = require("child_process");
    execSync(`ln -s ${repoMemory} ${wtMemory}`);

    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const ctx: PluginContext = {
        taskId: "TEST-1",
        branch: "feature/TEST-1",
        env: {},
        repo,
        wtPath: wt,
      };
      // Should not throw even when symlink already exists
      await claude.postCreate!(ctx, {});
      expect(existsSync(wtMemory)).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("bindPlugin creates a Plugin with postCreate", () => {
    const plugin = bindPlugin(claude, {});
    expect(plugin.name).toBe("claude");
    expect(plugin.postCreate).toBeDefined();
  });
});

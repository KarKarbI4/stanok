import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import { ide } from "../index";
import { bindPlugin, type PluginContext } from "@stanok/core/plugin";
import { mkdirSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ide plugin", () => {
  test("has correct name", () => {
    expect(ide.name).toBe("ide");
  });

  test("has default settings", () => {
    expect("ide.binary" in ide.settings).toBe(true);
    expect("ide.args" in ide.settings).toBe(true);
    expect(Array.isArray(ide.settings["ide.args"])).toBe(true);
  });

  test("has pruneIgnore for .cursor", () => {
    expect(ide.pruneIgnore).toContain("**/.cursor/**");
  });

  test("defines preStart hook", () => {
    expect(ide.preStart).toBeDefined();
    expect(typeof ide.preStart).toBe("function");
  });

  test("preStart does nothing when binary is empty", async () => {
    const settings = { "ide.binary": "", "ide.args": [] as string[] };
    const ctx: PluginContext = {
      taskId: "TEST-1",
      branch: "feature/TEST-1",
      env: {},
      repo: "/tmp/repo",
      wtPath: "/tmp/wt",
    };
    // Should not throw
    await ide.preStart!(ctx, settings);
  });

  test("preStart does nothing when wtPath doesn't exist", async () => {
    const settings = { "ide.binary": "code", "ide.args": [] as string[] };
    const ctx: PluginContext = {
      taskId: "TEST-1",
      branch: "feature/TEST-1",
      env: {},
      repo: "/tmp/repo",
      wtPath: "/tmp/nonexistent-wt-path-" + Date.now(),
    };
    // Should not throw
    await ide.preStart!(ctx, settings);
  });

  test("bindPlugin creates a Plugin with preStart", () => {
    const settings = { "ide.binary": "cursor", "ide.args": ["--new-window"] };
    const plugin = bindPlugin(ide, settings);
    expect(plugin.name).toBe("ide");
    expect(plugin.pruneIgnore).toContain("**/.cursor/**");
    expect(plugin.preStart).toBeDefined();
  });
});

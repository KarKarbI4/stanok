import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import { portless } from "../index";
import { bindPlugin, type PluginContext } from "@stanok/core/plugin";

describe("portless plugin", () => {
  test("has correct name", () => {
    expect(portless.name).toBe("portless");
  });

  test("has empty settings", () => {
    expect(portless.settings).toEqual({});
  });

  test("defines preStop hook", () => {
    expect(portless.preStop).toBeDefined();
    expect(typeof portless.preStop).toBe("function");
  });

  test("defines port command", () => {
    expect(portless.commands).toBeDefined();
    expect(portless.commands!.port).toBeDefined();
  });

  test("port command factory returns command object", () => {
    const cmd = portless.commands!.port({}, () => null);
    expect(cmd).not.toBeNull();
    expect(cmd!.desc).toBe("Show dev server port");
    expect(cmd!.usage).toBe("[TASK_ID]");
    expect(typeof cmd!.run).toBe("function");
  });

  test("preStop runs without throwing", async () => {
    const ctx: PluginContext = {
      taskId: "TEST-1",
      branch: "feature/TEST-1",
      env: {},
      repo: "/tmp/repo",
      wtPath: "/tmp/wt",
    };
    // pkill will likely fail in test (no matching process), but nothrow() handles it
    await portless.preStop!(ctx, {});
  });

  test("bindPlugin creates a Plugin with preStop", () => {
    const plugin = bindPlugin(portless, {});
    expect(plugin.name).toBe("portless");
    expect(plugin.preStop).toBeDefined();
  });
});

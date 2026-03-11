import { describe, expect, test, mock } from "bun:test";
import { agentCli } from "../index";
import { bindPlugin, type PluginContext } from "@stanok/core/plugin";

describe("agent-cli plugin", () => {
  test("has correct name", () => {
    expect(agentCli.name).toBe("agent-cli");
  });

  test("has default settings", () => {
    expect(agentCli.settings["agent-cli.terminal"]).toBe("iterm");
    expect(agentCli.settings["agent-cli.binary"]).toBe("");
    expect(agentCli.settings["agent-cli.args"]).toEqual([]);
  });

  test("defines preStart hook", () => {
    expect(agentCli.preStart).toBeDefined();
    expect(typeof agentCli.preStart).toBe("function");
  });

  test("preStart does nothing when binary is empty", () => {
    const settings = {
      "agent-cli.terminal": "iterm" as const,
      "agent-cli.binary": "",
      "agent-cli.args": [] as string[],
    };
    const ctx: PluginContext = {
      taskId: "TEST-1",
      branch: "feature/TEST-1",
      env: {},
      repo: "/tmp/repo",
      wtPath: "/tmp/wt",
    };
    // Should not throw
    agentCli.preStart!(ctx, settings);
  });

  test("preStart does nothing when wtPath doesn't exist", () => {
    const settings = {
      "agent-cli.terminal": "iterm" as const,
      "agent-cli.binary": "claude",
      "agent-cli.args": [] as string[],
    };
    const ctx: PluginContext = {
      taskId: "TEST-1",
      branch: "feature/TEST-1",
      env: {},
      repo: "/tmp/repo",
      wtPath: "/tmp/nonexistent-" + Date.now(),
    };
    // Should not throw (existsSync returns false)
    agentCli.preStart!(ctx, settings);
  });

  test("bindPlugin creates a Plugin with preStart", () => {
    const settings = {
      "agent-cli.terminal": "tmux" as const,
      "agent-cli.binary": "claude",
      "agent-cli.args": ["--model", "opus"],
    };
    const plugin = bindPlugin(agentCli, settings);
    expect(plugin.name).toBe("agent-cli");
    expect(plugin.preStart).toBeDefined();
  });

  test("settings type allows iterm and tmux", () => {
    expect(agentCli.settings["agent-cli.terminal"]).toBe("iterm");
    // Type constraint verified by compilation — no runtime assertion needed
  });
});

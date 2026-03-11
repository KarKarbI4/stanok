import { describe, expect, test, mock } from "bun:test";
import { PluginRegistry } from "../registry";
import { definePlugin, type AuthResolver } from "../plugin";
import type { IssueTracker, CodeHost, Issue } from "../services";

// Minimal mock implementations
function mockIssueTracker(): IssueTracker {
  return {
    async getIssue(key) {
      return { key, summary: "Test", status: "Open", fields: {} };
    },
    async search() { return []; },
    async myself() { return { name: "user", displayName: "User" }; },
    issueUrl(key) { return `http://test/browse/${key}`; },
  };
}

function mockCodeHost(): CodeHost {
  return {
    async findOpenPR() { return null; },
    async createPR(title) { return { id: 1, title, url: "http://test/pr/1", state: "OPEN" }; },
    createPRUrl() { return "http://test/create-pr"; },
    prUrl(id) { return `http://test/pr/${id}`; },
  };
}

const auth: AuthResolver = (url) => ({ token: "test-token" });
const noAuth: AuthResolver = () => null;

describe("PluginRegistry", () => {
  test("resolves services from provides", () => {
    const plugin = definePlugin({
      name: "test-tracker",
      settings: { "test.url": "http://default" },
      provides: {
        issueTracker(settings) {
          return settings["test.url"] ? mockIssueTracker() : null;
        },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    expect(reg.issueTracker).not.toBeNull();
    expect(reg.codeHost).toBeNull();
  });

  test("returns null when auth missing", () => {
    const plugin = definePlugin({
      name: "needs-auth",
      settings: { "svc.url": "http://svc" },
      provides: {
        issueTracker(settings, auth) {
          const a = auth(settings["svc.url"]);
          if (!a) return null;
          return mockIssueTracker();
        },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, noAuth);
    expect(reg.issueTracker).toBeNull();
  });

  test("project settings override plugin defaults", () => {
    let capturedUrl = "";
    const plugin = definePlugin({
      name: "test",
      settings: { "svc.url": "http://default" },
      provides: {
        issueTracker(settings) {
          capturedUrl = settings["svc.url"];
          return mockIssueTracker();
        },
      },
    });

    new PluginRegistry([plugin], { "svc.url": "http://project" }, {}, auth);
    expect(capturedUrl).toBe("http://project");
  });

  test("personal settings override project settings", () => {
    let capturedUrl = "";
    const plugin = definePlugin({
      name: "test",
      settings: { "svc.url": "http://default" },
      provides: {
        issueTracker(settings) {
          capturedUrl = settings["svc.url"];
          return mockIssueTracker();
        },
      },
    });

    new PluginRegistry(
      [plugin],
      { "svc.url": "http://project" },
      { "svc.url": "http://personal" },
      auth,
    );
    expect(capturedUrl).toBe("http://personal");
  });

  test("allPlugins returns bound plugins", () => {
    const plugin = definePlugin({
      name: "my-plugin",
      settings: {},
      pruneIgnore: ["/tmp/*"],
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const plugins = reg.allPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("my-plugin");
    expect(plugins[0].pruneIgnore).toEqual(["/tmp/*"]);
  });

  test("commands() returns registered plugin commands", () => {
    const plugin = definePlugin({
      name: "cmd-test",
      settings: { "x.url": "http://x" },
      commands: {
        myCmd(settings) {
          if (!settings["x.url"]) return null;
          return {
            desc: "My command",
            usage: "<ARG>",
            async run() {},
          };
        },
        nullCmd() {
          return null;
        },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const cmds = reg.commands();
    expect(cmds).toHaveProperty("myCmd");
    expect(cmds.myCmd.desc).toBe("My command");
    expect(cmds.myCmd.usage).toBe("<ARG>");
    expect(cmds).not.toHaveProperty("nullCmd");
  });

  test("commandMeta() returns metadata for caching", () => {
    const plugin = definePlugin({
      name: "meta-test",
      settings: {},
      commands: {
        hello() {
          return { desc: "Say hello", async run() {} };
        },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const meta = reg.commandMeta();
    expect(meta.hello).toEqual({ desc: "Say hello", usage: undefined, plugin: "meta-test" });
  });

  test("multiple plugins, last provides wins", () => {
    const plugin1 = definePlugin({
      name: "tracker-a",
      settings: {},
      provides: {
        issueTracker() { return mockIssueTracker(); },
      },
    });
    const plugin2 = definePlugin({
      name: "tracker-b",
      settings: {},
      provides: {
        issueTracker() {
          const t = mockIssueTracker();
          t.issueUrl = (k) => `http://b/${k}`;
          return t;
        },
      },
    });

    const reg = new PluginRegistry([plugin1, plugin2], {}, {}, auth);
    expect(reg.issueTracker!.issueUrl("X")).toBe("http://b/X");
  });

  test("get<T> returns typed service", () => {
    const plugin = definePlugin({
      name: "test",
      settings: {},
      provides: {
        codeHost() { return mockCodeHost(); },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const ch = reg.get<CodeHost>("codeHost");
    expect(ch).not.toBeNull();
    expect(ch!.createPRUrl("b", "m")).toBe("http://test/create-pr");
  });

  test("enrich delegates to plugins", async () => {
    const plugin = definePlugin({
      name: "enricher",
      settings: {},
      async enrich(tasks) {
        for (const t of tasks) {
          (t as any).summary = `Summary for ${t.task_id}`;
        }
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const tasks = [
      { task_id: "T-1", branch: "T-1", path: "/tmp/t1", repo: "/repo", created_at: "" },
      { task_id: "T-2", branch: "T-2", path: "/tmp/t2", repo: "/repo", created_at: "" },
    ];
    await reg.enrich(tasks);
    expect((tasks[0] as any).summary).toBe("Summary for T-1");
    expect((tasks[1] as any).summary).toBe("Summary for T-2");
  });

  test("enrich swallows plugin errors", async () => {
    const plugin = definePlugin({
      name: "failing-enricher",
      settings: {},
      async enrich() {
        throw new Error("enrich failed");
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    const tasks = [{ task_id: "T-1", branch: "T-1", path: "/tmp", repo: "/repo", created_at: "" }];
    await reg.enrich(tasks); // should not throw
    expect(tasks[0].task_id).toBe("T-1");
  });

  test("statusColors returns first plugin's colors", () => {
    const plugin1 = definePlugin({
      name: "tracker-colors",
      settings: {},
      statusColors() {
        return { open: ["New"], inProgress: ["Working"], done: ["Shipped"] };
      },
    });
    const plugin2 = definePlugin({
      name: "other-colors",
      settings: {},
      statusColors() {
        return { open: ["X"], inProgress: ["Y"], done: ["Z"] };
      },
    });

    const reg = new PluginRegistry([plugin1, plugin2], {}, {}, auth);
    const colors = reg.statusColors();
    expect(colors).toEqual({ open: ["New"], inProgress: ["Working"], done: ["Shipped"] });
  });

  test("statusColors returns null when no plugin provides it", () => {
    const plugin = definePlugin({ name: "no-colors", settings: {} });
    const reg = new PluginRegistry([plugin], {}, {}, auth);
    expect(reg.statusColors()).toBeNull();
  });

  test("statusColors skips plugins returning null", () => {
    const plugin1 = definePlugin({
      name: "no-url",
      settings: { "svc.url": "" },
      statusColors(settings) {
        if (!settings["svc.url"]) return null;
        return { open: ["X"], inProgress: ["Y"], done: ["Z"] };
      },
    });
    const plugin2 = definePlugin({
      name: "has-url",
      settings: {},
      statusColors() {
        return { open: ["A"], inProgress: ["B"], done: ["C"] };
      },
    });

    const reg = new PluginRegistry([plugin1, plugin2], {}, {}, auth);
    expect(reg.statusColors()).toEqual({ open: ["A"], inProgress: ["B"], done: ["C"] });
  });

  test("provides returning null does not register service", () => {
    const plugin = definePlugin({
      name: "maybe",
      settings: { "svc.url": "" },
      provides: {
        issueTracker(settings) {
          if (!settings["svc.url"]) return null;
          return mockIssueTracker();
        },
      },
    });

    const reg = new PluginRegistry([plugin], {}, {}, auth);
    expect(reg.issueTracker).toBeNull();
  });
});

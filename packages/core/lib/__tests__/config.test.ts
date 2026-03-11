import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  taskIdUpper,
  taskIdLower,
  worktreePath,
  branchName,
  readConfigAsync,
  writeConfig,
  readStateAsync,
  writeState,
  readEnvFile,
  listWorktrees,
  readTask,
  detectRepo,
  loadRepoConfig,
  loadPluginRegistry,
  extractDotKeys,
} from "../config";
import {
  readAuth,
  getAuth,
  setAuth,
  withAuthRetry,
  promptToken,
  requireAuth,
  type AuthConfig,
} from "../auth";
import { definePlugin, bindPlugin } from "../plugin";
import type { Plugin, PluginDef } from "../plugin";
import { createTempRepo, withTestEnv, writeWbConfig, writeWbState, writeWorkbenchJson, captureOutput } from "../../__tests__/helpers";

describe("taskIdUpper", () => {
  test("uppercases task ID", () => {
    expect(taskIdUpper("mp3ui-1811")).toBe("MP3UI-1811");
  });

  test("already uppercase stays unchanged", () => {
    expect(taskIdUpper("MP3UI-1811")).toBe("MP3UI-1811");
  });

  test("mixed case", () => {
    expect(taskIdUpper("Mp3Ui-1811")).toBe("MP3UI-1811");
  });
});

describe("taskIdLower", () => {
  test("lowercases task ID", () => {
    expect(taskIdLower("MP3UI-1811")).toBe("mp3ui-1811");
  });

  test("already lowercase stays unchanged", () => {
    expect(taskIdLower("mp3ui-1811")).toBe("mp3ui-1811");
  });
});

describe("worktreePath", () => {
  test("resolves to __worktrees subdirectory with lowercased task ID", () => {
    const result = worktreePath("/home/user/repo", "MP3UI-1811");
    expect(result).toBe("/home/user/repo__worktrees/mp3ui-1811");
  });

  test("works with nested repo paths", () => {
    const result = worktreePath("/a/b/c/myrepo", "TASK-42");
    expect(result).toBe("/a/b/c/myrepo__worktrees/task-42");
  });
});

describe("branchName", () => {
  test("creates branch with default template", () => {
    expect(branchName("MP3UI-1811")).toBe("MP3UI-1811");
  });

  test("creates branch with feature template", () => {
    expect(branchName("MP3UI-1811", "feature/{task}")).toBe("feature/MP3UI-1811");
  });

  test("creates branch with bugfix template", () => {
    expect(branchName("MP3UI-1811", "bugfix/{task}")).toBe("bugfix/MP3UI-1811");
  });

  test("creates branch with prefix and suffix", () => {
    expect(branchName("MP3UI-1811", "user/viktor/{task}/wip")).toBe("user/viktor/MP3UI-1811/wip");
  });

  test("uppercases task ID in branch", () => {
    expect(branchName("mp3ui-1811", "feature/{task}")).toBe("feature/MP3UI-1811");
  });

  test("bare template", () => {
    expect(branchName("MP3UI-1811", "{task}")).toBe("MP3UI-1811");
  });
});

// ─── readConfigAsync ────────────────────────────────────────────────────────

describe("readConfigAsync", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("file missing returns {}", async () => {
    env = await createTempRepo();
    rmSync(join(env.home, ".stanok", "settings.json"), { force: true });
    const config = await withTestEnv(env, () => readConfigAsync());
    expect(config).toEqual({});
  });

  test("valid JSON is parsed", async () => {
    env = await createTempRepo();
    writeWbConfig(env.home, { "ide.binary": "cursor" });
    const config = await withTestEnv(env, () => readConfigAsync());
    expect(config["ide.binary"]).toBe("cursor");
  });

  test("corrupt JSON returns {}", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "settings.json"), "{invalid");
    const config = await withTestEnv(env, () => readConfigAsync());
    expect(config).toEqual({});
  });
});

describe("writeConfig", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("merges patch into existing config", async () => {
    env = await createTempRepo();
    writeWbConfig(env.home, { "ide.binary": "cursor" });
    await withTestEnv(env, () => writeConfig({ "hooks.preStart": ["echo hi"] } as any));
    const config = await withTestEnv(env, () => readConfigAsync());
    expect(config["ide.binary"]).toBe("cursor");
    expect(config["hooks.preStart"]).toEqual(["echo hi"]);
  });
});

// ─── readStateAsync ─────────────────────────────────────────────────────────

describe("readStateAsync", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("file missing returns {repos:[]}", async () => {
    env = await createTempRepo();
    rmSync(join(env.home, ".stanok", "state.json"), { force: true });
    rmSync(join(env.home, ".stanok", "settings.json"), { force: true });
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repos).toEqual([]);
  });

  test("valid JSON is parsed", async () => {
    env = await createTempRepo();
    writeWbState(env.home, { repos: ["/async/path"] });
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repos).toEqual(["/async/path"]);
  });

  test("migrates from settings.json if state.json missing", async () => {
    env = await createTempRepo();
    rmSync(join(env.home, ".stanok", "state.json"), { force: true });
    writeWbConfig(env.home, { repos: ["/legacy"], last_stand: "DO81" });
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repos).toContain("/legacy");
    expect(state.last_stand).toBe("DO81");
  });

  test("corrupt JSON returns {repos:[]}", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "state.json"), "{invalid");
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repos).toEqual([]);
  });
});

describe("writeState", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("merges patch into existing state", async () => {
    env = await createTempRepo();
    writeWbState(env.home, { repos: ["/a"] });
    await withTestEnv(env, () => writeState({ last_stand: "dev5" }));
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repos).toEqual(["/a"]);
    expect(state.last_stand).toBe("dev5");
  });

  test("deep-merges repo_env", async () => {
    env = await createTempRepo();
    writeWbState(env.home, { repos: [], repo_env: { "/a": { X: "1" } } });
    await withTestEnv(env, () => writeState({ repo_env: { "/b": { Y: "2" } } }));
    const state = await withTestEnv(env, () => readStateAsync());
    expect(state.repo_env).toEqual({ "/a": { X: "1" }, "/b": { Y: "2" } });
  });
});

// ─── readEnvFile ─────────────────────────────────────────────────────────────

describe("readEnvFile", () => {
  test("missing file returns {}", () => {
    const tmpDir = join(tmpdir(), `wb-envf-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    expect(readEnvFile(tmpDir)).toEqual({});
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("comments and blank lines are skipped", () => {
    const tmpDir = join(tmpdir(), `wb-envf2-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, ".env.development.local"), "# comment\n\nKEY=val\n");
    const result = readEnvFile(tmpDir);
    expect(result).toEqual({ KEY: "val" });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("lines without = are skipped", () => {
    const tmpDir = join(tmpdir(), `wb-envf3-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, ".env.development.local"), "NOEQUALS\nKEY=val\n");
    const result = readEnvFile(tmpDir);
    expect(result).toEqual({ KEY: "val" });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("value with = preserved", () => {
    const tmpDir = join(tmpdir(), `wb-envf4-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, ".env.development.local"), "URL=http://host:3000/path?a=b\n");
    const result = readEnvFile(tmpDir);
    expect(result.URL).toBe("http://host:3000/path?a=b");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─── listWorktrees ───────────────────────────────────────────────────────────

describe("listWorktrees", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("worktrees in __worktrees path returned", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "wt-1");
    await $`git -C ${env.repo} worktree add ${wtPath} -b feature/WT-1 origin/master`.quiet();

    const entries = await listWorktrees(env.repo);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.branch.includes("feature/WT-1"))).toBe(true);
  });

  test("main repo not included", async () => {
    env = await createTempRepo();
    const entries = await listWorktrees(env.repo);
    // Main repo is not in __worktrees path — should be empty
    expect(entries).toEqual([]);
  });

  test("git error returns empty", async () => {
    const entries = await listWorktrees("/nonexistent/repo");
    expect(entries).toEqual([]);
  });
});

// ─── readTask ────────────────────────────────────────────────────────────────

describe("readTask", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("found returns TaskMeta", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "rt-1");
    await $`git -C ${env.repo} worktree add ${wtPath} -b feature/RT-1 origin/master`.quiet();

    const task = await withTestEnv(env, () => readTask("rt-1"));
    expect(task).not.toBeNull();
    expect(task!.task_id).toBe("RT-1");
    expect(task!.branch).toBe("RT-1");
  });

  test("not found returns null", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const task = await withTestEnv(env, () => readTask("NONEXIST-99"));
    expect(task).toBeNull();
  });
});

// ─── detectRepo ──────────────────────────────────────────────────────────────

describe("detectRepo", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("walk-up finds registered repo", async () => {
    env = await createTempRepo();
    const sub = join(env.repo, "sub", "deep");
    mkdirSync(sub, { recursive: true });
    const repo = await withTestEnv(env, () => detectRepo(sub));
    expect(repo).toBe(env.repo);
  });

  test("no repos returns null", async () => {
    env = await createTempRepo();
    writeWbState(env.home, { repos: [] });
    const repo = await withTestEnv(env, () => detectRepo("/tmp"));
    expect(repo).toBeNull();
  });

  test("worktree .git file fallback", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "detect-1");
    await $`git -C ${env.repo} worktree add ${wtPath} -b feature/DETECT-1 origin/master`.quiet();

    const repo = await withTestEnv(env, () => detectRepo(wtPath));
    expect(repo).toBe(env.repo);
  });

  test("worktree .git file with unregistered main repo still resolves via git", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {});
    const wtPath = resolve(env.repo, "..", "repo__worktrees", "detect-unreg");
    await $`git -C ${env.repo} worktree add ${wtPath} -b feature/DETECT-UNREG origin/master`.quiet();

    // Even with different repos in state, detectRepo resolves via git
    writeWbState(env.home, { repos: ["/nonexistent/repo"] });

    const repo = await withTestEnv(env, () => detectRepo(wtPath));
    expect(repo).toBe(env.repo);
  });
});

// ─── loadRepoConfig ──────────────────────────────────────────────────────────

describe("loadRepoConfig", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("returns merged RepoConfig", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, { "jira.url": "http://j", "jira.project": "P" });
    const rc = loadRepoConfig(env.repo);
    expect(rc.workbench["jira.url"]).toBe("http://j");
    expect(rc.workbench.baseBranch).toBe("master");
    expect(rc.repoPath).toBe(env.repo);
  });
});

// ─── definePlugin + bindPlugin ──────────────────────────────────────────────

describe("definePlugin", () => {
  test("returns the same PluginDef", () => {
    const def = definePlugin({
      name: "test-plugin",
      settings: { "test.color": "red", "test.size": 10 },
    });
    expect(def.name).toBe("test-plugin");
    expect(def.settings).toEqual({ "test.color": "red", "test.size": 10 });
  });

  test("pruneIgnore passed through", () => {
    const def = definePlugin({
      name: "test",
      settings: {},
      pruneIgnore: ["**/foo/**"],
    });
    expect(def.pruneIgnore).toEqual(["**/foo/**"]);
  });
});

describe("bindPlugin", () => {
  test("binds settings into hook calls", () => {
    let captured: any;
    const def = definePlugin({
      name: "test",
      settings: { "test.color": "red", "test.size": 10 },
      preStart(_ctx, s) { captured = s; },
    });
    const plugin = bindPlugin(def, { "test.color": "blue", "test.size": 10 });
    plugin.preStart!({ taskId: "", branch: "", env: {}, repo: "", wtPath: "" });
    expect(captured).toEqual({ "test.color": "blue", "test.size": 10 });
  });

  test("no hooks means undefined on Plugin", () => {
    const def = definePlugin({ name: "bare", settings: {} });
    const plugin = bindPlugin(def, {});
    expect(plugin.postCreate).toBeUndefined();
    expect(plugin.preStart).toBeUndefined();
    expect(plugin.postRemove).toBeUndefined();
  });

  test("pruneIgnore passed through", () => {
    const def = definePlugin({
      name: "test",
      settings: {},
      pruneIgnore: ["**/foo/**"],
    });
    expect(bindPlugin(def, {}).pruneIgnore).toEqual(["**/foo/**"]);
  });
});

// ─── extractDotKeys ─────────────────────────────────────────────────────────

describe("extractDotKeys", () => {
  test("extracts only dot-separated keys", () => {
    const result = extractDotKeys({
      baseBranch: "master",
      "ide.binary": "cursor",
      "agent-cli.terminal": "tmux",
      repos: [],
    });
    expect(result).toEqual({
      "ide.binary": "cursor",
      "agent-cli.terminal": "tmux",
    });
  });

  test("empty object returns empty", () => {
    expect(extractDotKeys({})).toEqual({});
  });

  test("no dot keys returns empty", () => {
    expect(extractDotKeys({ foo: 1, bar: 2 })).toEqual({});
  });
});

// ─── loadPluginRegistry (user plugins) ──────────────────────────────────────

describe("loadPluginRegistry (user plugins)", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("returns empty registry when no plugins.ts", async () => {
    env = await createTempRepo();
    const registry = await withTestEnv(env, () =>
      loadPluginRegistry(
        { baseBranch: "master", branchTemplate: "{task}", proxyPort: 1355, mergeDetection: "Pull request" },
        {},
      ),
    );
    const plugins = registry.allPlugins();
    expect(plugins.length).toBe(0);
  });

  test("loads user plugins from ~/.stanok/plugins.ts", async () => {
    env = await createTempRepo();
    const pluginMod = join(import.meta.dir, "..", "plugin.ts");
    writeFileSync(
      join(env.home, ".stanok", "plugins.ts"),
      `import { definePlugin, definePlugins } from "${pluginMod}";
const myPlugin = definePlugin({ name: "my-plugin", settings: { "my.opt": "default" } });
export const plugins = definePlugins([myPlugin]);`,
    );
    const registry = await withTestEnv(env, () =>
      loadPluginRegistry(
        { baseBranch: "master", branchTemplate: "{task}", proxyPort: 1355, mergeDetection: "Pull request" },
        {},
      ),
    );
    const plugins = registry.allPlugins();
    expect(plugins.some((p) => p.name === "my-plugin")).toBe(true);
  });

  test("settings resolution: defaults ← project ← personal", async () => {
    env = await createTempRepo();
    const pluginMod = join(import.meta.dir, "..", "plugin.ts");
    writeFileSync(
      join(env.home, ".stanok", "plugins.ts"),
      `import { definePlugin, definePlugins } from "${pluginMod}";
const test = definePlugin({
  name: "test",
  settings: { "test.a": "default-a", "test.b": "default-b", "test.c": "default-c" },
  preStart(_ctx, s) { (globalThis as any).__testSettings = s; },
});
export const plugins = definePlugins([test]);`,
    );
    const registry = await withTestEnv(env, () =>
      loadPluginRegistry(
        {
          baseBranch: "master", branchTemplate: "{task}", proxyPort: 1355, mergeDetection: "Pull request",
          "test.a": "project-a",
          "test.b": "project-b",
        } as any,
        {
          "test.b": "personal-b",
        } as any,
      ),
    );
    const plugins = registry.allPlugins();
    const testPlugin = plugins.find((p) => p.name === "test")!;
    testPlugin.preStart!({ taskId: "", branch: "", env: {}, repo: "", wtPath: "" });
    const s = (globalThis as any).__testSettings;
    expect(s["test.a"]).toBe("project-a");
    expect(s["test.b"]).toBe("personal-b");
    expect(s["test.c"]).toBe("default-c");
    delete (globalThis as any).__testSettings;
  });

  test("invalid plugins.ts logs error", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "plugins.ts"), "export default SYNTAX ERROR {{{");
    const { stderr } = await captureOutput(async () => {
      await withTestEnv(env, () =>
        loadPluginRegistry(
          { baseBranch: "master", branchTemplate: "{task}", proxyPort: 1355, mergeDetection: "Pull request" },
          {},
        ),
      );
    });
    expect(stderr).toContain("failed to load");
  });
});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("readAuth", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("no file returns {}", async () => {
    env = await createTempRepo();
    const result = await withTestEnv(env, async () => readAuth());
    expect(result).toEqual({});
  });

  test("modern format parsed", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://jira.test": { token: "tok123" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));
    const result = await withTestEnv(env, async () => readAuth());
    expect(result["http://jira.test"]?.token).toBe("tok123");
  });

  test("corrupt file returns {}", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "CORRUPT{{{");
    const result = await withTestEnv(env, async () => readAuth());
    expect(result).toEqual({});
  });
});

describe("getAuth", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("exact match", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://jira.test": { token: "t1" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));
    const result = await withTestEnv(env, async () => getAuth("http://jira.test"));
    expect(result?.token).toBe("t1");
  });

  test("trailing slash variant", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://jira.test/": { token: "t2" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));
    const result = await withTestEnv(env, async () => getAuth("http://jira.test"));
    expect(result?.token).toBe("t2");
  });

  test("not found returns null", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");
    const result = await withTestEnv(env, async () => getAuth("http://unknown.test"));
    expect(result).toBeNull();
  });
});

describe("setAuth", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("writes correctly", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");
    await withTestEnv(env, async () => {
      setAuth("http://new.test", { token: "new-tok" });
    });
    const raw = JSON.parse(readFileSync(join(env.home, ".stanok", "auth.json"), "utf-8"));
    expect(raw["http://new.test"]?.token).toBe("new-tok");
  });
});

describe("withAuthRetry", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let origFetch: typeof globalThis.fetch;
  afterEach(() => {
    env?.cleanup();
    globalThis.fetch = origFetch;
  });
  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  test("action succeeds with existing token", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://svc.test": { token: "good-tok" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));

    const result = await withTestEnv(env, () =>
      withAuthRetry(
        "Test",
        "http://svc.test",
        (token) => ({ token }),
        async (client) => `ok:${client.token}`,
      ),
    );
    expect(result).toBe("ok:good-tok");
  });

  test("non-auth error rethrown", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://svc.test": { token: "tok" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));

    try {
      await withTestEnv(env, () =>
        withAuthRetry(
          "Test",
          "http://svc.test",
          (token) => ({ token }),
          async () => {
            throw new Error("Network error");
          },
        ),
      );
      expect.unreachable("should throw");
    } catch (e: any) {
      expect(e.message).toBe("Network error");
    }
  });

  test("401 error clears token and retries", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://svc.test": { token: "old-tok" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));

    // Mock stdin completely to prevent hanging
    const origOn = process.stdin.on.bind(process.stdin);
    const origIsTTY = process.stdin.isTTY;
    const origPause = process.stdin.pause.bind(process.stdin);
    const origUnref = process.stdin.unref?.bind(process.stdin);
    const origRemoveListener = process.stdin.removeListener.bind(process.stdin);
    (process.stdin as any).isTTY = false;
    (process.stdin as any).pause = () => process.stdin;
    (process.stdin as any).unref = () => process.stdin;
    (process.stdin as any).removeListener = () => process.stdin;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          for (const ch of "new-tok") handler(Buffer.from(ch));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn(event, handler);
    };

    let callCount = 0;
    const result = await withTestEnv(env, () =>
      withAuthRetry(
        "Test",
        "http://svc.test",
        (token) => ({ token }),
        async (client) => {
          callCount++;
          if (callCount === 1) {
            const err: any = new Error("Unauthorized");
            err.status = 401;
            throw err;
          }
          return `ok:${client.token}`;
        },
      ),
    );

    (process.stdin as any).on = origOn;
    (process.stdin as any).isTTY = origIsTTY;
    (process.stdin as any).pause = origPause;
    if (origUnref) (process.stdin as any).unref = origUnref;
    (process.stdin as any).removeListener = origRemoveListener;

    expect(callCount).toBe(2);
    expect(result).toBe("ok:new-tok");
  });

  test("no token prompts user", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");

    const origOn = process.stdin.on.bind(process.stdin);
    const origIsTTY = process.stdin.isTTY;
    const origPause = process.stdin.pause.bind(process.stdin);
    const origUnref = process.stdin.unref?.bind(process.stdin);
    const origRemoveListener = process.stdin.removeListener.bind(process.stdin);
    (process.stdin as any).isTTY = false;
    (process.stdin as any).pause = () => process.stdin;
    (process.stdin as any).unref = () => process.stdin;
    (process.stdin as any).removeListener = () => process.stdin;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          for (const ch of "prompted-tok") handler(Buffer.from(ch));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn(event, handler);
    };

    const result = await withTestEnv(env, () =>
      withAuthRetry(
        "Test",
        "http://svc.test",
        (token) => ({ token }),
        async (client) => `ok:${client.token}`,
      ),
    );

    (process.stdin as any).on = origOn;
    (process.stdin as any).isTTY = origIsTTY;
    (process.stdin as any).pause = origPause;
    if (origUnref) (process.stdin as any).unref = origUnref;
    (process.stdin as any).removeListener = origRemoveListener;

    expect(result).toBe("ok:prompted-tok");
  });
});

// ─── promptToken ────────────────────────────────────────────────────────────

function mockStdin(input: string) {
  const origOn = process.stdin.on.bind(process.stdin);
  const origIsTTY = process.stdin.isTTY;
  const origPause = process.stdin.pause.bind(process.stdin);
  const origUnref = process.stdin.unref?.bind(process.stdin);
  const origRemoveListener = process.stdin.removeListener.bind(process.stdin);
  (process.stdin as any).isTTY = false;
  (process.stdin as any).pause = () => process.stdin;
  (process.stdin as any).unref = () => process.stdin;
  (process.stdin as any).removeListener = () => process.stdin;
  (process.stdin as any).on = (event: string, handler: Function) => {
    if (event === "data") {
      setTimeout(() => {
        for (const ch of input) handler(Buffer.from(ch));
        handler(Buffer.from("\r"));
      }, 5);
      return process.stdin;
    }
    return origOn(event, handler);
  };
  return () => {
    (process.stdin as any).on = origOn;
    (process.stdin as any).isTTY = origIsTTY;
    (process.stdin as any).pause = origPause;
    if (origUnref) (process.stdin as any).unref = origUnref;
    (process.stdin as any).removeListener = origRemoveListener;
  };
}

describe("promptToken", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("reads token from stdin and saves to auth", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");

    const restore = mockStdin("my-token");
    const token = await withTestEnv(env, () =>
      promptToken("TestSvc", "http://svc.test", "Create token at http://svc.test/tokens"),
    );
    restore();

    expect(token).toBe("my-token");
    const saved = await withTestEnv(env, async () => getAuth("http://svc.test"));
    expect(saved?.token).toBe("my-token");
  });

  test("backspace removes last character", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");

    // Custom mock: type "abc", backspace, "d", enter → "abd"
    const origOn = process.stdin.on.bind(process.stdin);
    const origIsTTY = process.stdin.isTTY;
    const origPause = process.stdin.pause.bind(process.stdin);
    const origUnref = process.stdin.unref?.bind(process.stdin);
    const origRemoveListener = process.stdin.removeListener.bind(process.stdin);
    (process.stdin as any).isTTY = false;
    (process.stdin as any).pause = () => process.stdin;
    (process.stdin as any).unref = () => process.stdin;
    (process.stdin as any).removeListener = () => process.stdin;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          handler(Buffer.from("a"));
          handler(Buffer.from("b"));
          handler(Buffer.from("c"));
          handler(Buffer.from("\x7f")); // backspace
          handler(Buffer.from("d"));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn(event, handler);
    };

    const token = await withTestEnv(env, () =>
      promptToken("TestSvc", "http://svc.test"),
    );

    (process.stdin as any).on = origOn;
    (process.stdin as any).isTTY = origIsTTY;
    (process.stdin as any).pause = origPause;
    if (origUnref) (process.stdin as any).unref = origUnref;
    (process.stdin as any).removeListener = origRemoveListener;

    expect(token).toBe("abd");
  });
});

// ─── requireAuth ────────────────────────────────────────────────────────────

describe("requireAuth", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  afterEach(() => env?.cleanup());

  test("existing token returns immediately", async () => {
    env = await createTempRepo();
    const auth: AuthConfig = { "http://svc.test": { token: "existing" } };
    writeFileSync(join(env.home, ".stanok", "auth.json"), JSON.stringify(auth));

    const result = await withTestEnv(env, () =>
      requireAuth("http://svc.test", "TestSvc"),
    );
    expect(result.token).toBe("existing");
  });

  test("no token prompts and returns", async () => {
    env = await createTempRepo();
    writeFileSync(join(env.home, ".stanok", "auth.json"), "{}");

    const restore = mockStdin("new-tok");
    const result = await withTestEnv(env, () =>
      requireAuth("http://svc.test", "TestSvc"),
    );
    restore();

    expect(result.token).toBe("new-tok");
  });
});


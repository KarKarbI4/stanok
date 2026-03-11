import { mkdirSync, writeFileSync, rmSync, chmodSync, realpathSync, existsSync, symlinkSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { $ } from "bun";

interface TestEnv {
  home: string;
  repo: string;
  binDir: string;
  cleanup: () => void;
}

/** Create a temporary bare repo + working clone with an initial commit. */
export async function createTempRepo(): Promise<TestEnv> {
  // Use realpathSync to resolve macOS /var → /private/var symlinks
  const rawBase = join(tmpdir(), `wb-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(rawBase, { recursive: true });
  const base = realpathSync(rawBase);

  const home = join(base, "home");
  const wbHome = join(home, ".stanok");
  const bareRepo = join(base, "bare.git");
  const repo = join(base, "repo");

  mkdirSync(home, { recursive: true });
  mkdirSync(wbHome, { recursive: true });

  // Init bare repo (serves as "origin") with master as default branch
  await $`git init --bare --initial-branch=master ${bareRepo}`.quiet();

  // Clone and make initial commit
  await $`git clone ${bareRepo} ${repo}`.quiet();
  await $`git -C ${repo} config user.email "test@test.com"`.quiet();
  await $`git -C ${repo} config user.name "Test"`.quiet();
  await $`git -C ${repo} checkout -b master`.quiet().nothrow();
  writeFileSync(join(repo, "README.md"), "# Test repo\n");
  await $`git -C ${repo} add README.md`.quiet();
  await $`git -C ${repo} commit -m "initial"`.quiet();
  await $`git -C ${repo} push -u origin master`.quiet();

  // Write minimal workbench state pointing to this repo
  writeFileSync(
    join(wbHome, "state.json"),
    JSON.stringify({ repos: [repo] }, null, 2),
  );

  // Create fake `open` command so tests don't open real browser
  const binDir = join(base, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "open"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(binDir, "open"), 0o755);

  return {
    home,
    repo,
    binDir,
    cleanup() {
      try {
        // Remove worktrees from git's tracking before deleting files
        const { execSync } = require("child_process");
        try {
          const wts = execSync(`git -C ${repo} worktree list --porcelain`, { encoding: "utf-8" });
          for (const block of wts.split("\n\n")) {
            const m = block.match(/^worktree (.+)/);
            if (m && m[1] !== repo) {
              execSync(`git -C ${repo} worktree remove ${m[1]} --force`, { stdio: "ignore" });
            }
          }
        } catch {}
        rmSync(base, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** Write .stanok/settings.json to the repo. */
export function writeWorkbenchJson(repo: string, config: Record<string, any>) {
  const stanokDir = join(repo, ".stanok");
  mkdirSync(stanokDir, { recursive: true });
  writeFileSync(join(stanokDir, "settings.json"), JSON.stringify(config, null, 2) + "\n");
}

/** Write ~/.stanok/settings.json (global user settings). */
export function writeWbConfig(home: string, config: Record<string, any>) {
  const wbHome = join(home, ".stanok");
  mkdirSync(wbHome, { recursive: true });
  writeFileSync(join(wbHome, "settings.json"), JSON.stringify(config, null, 2) + "\n");
}

/** Write a plugins.ts that imports the given plugins by name. */
export function writePluginsTs(home: string, plugins: ("jira" | "bitbucket")[]) {
  const exportMap: Record<string, { pkg: string; name: string }> = {
    jira: { pkg: "@stanok/plugin-jira", name: "jiraPlugin" },
    bitbucket: { pkg: "@stanok/plugin-bitbucket", name: "bitbucketPlugin" },
  };
  const imports: string[] = [];
  const names: string[] = [];
  for (const p of plugins) {
    const info = exportMap[p]!;
    imports.push(`import { ${info.name} } from "${info.pkg}";`);
    names.push(info.name);
  }
  const code = [...imports, `export const plugins = [${names.join(", ")}];`, ""].join("\n");
  writeFileSync(join(home, ".stanok", "plugins.ts"), code);

  // Ensure test env can resolve @stanok/* packages
  const nmLink = join(home, ".stanok", "node_modules", "@stanok");
  if (!existsSync(nmLink)) {
    const monorepoNm = resolve(__dirname, "../../../node_modules/@stanok");
    mkdirSync(join(home, ".stanok", "node_modules"), { recursive: true });
    symlinkSync(monorepoNm, nmLink);
  }
}

/** Write workbench state.json. */
export function writeWbState(home: string, state: Record<string, any>) {
  const wbHome = join(home, ".stanok");
  mkdirSync(wbHome, { recursive: true });
  writeFileSync(join(wbHome, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

/** Call a command function with custom HOME for isolation. */
export async function withTestEnv<T>(
  env: TestEnv,
  fn: () => Promise<T>,
): Promise<T> {
  const origHome = process.env.HOME;
  const origPath = process.env.PATH;
  const origWbTest = process.env.SK_TEST;
  process.env.HOME = env.home;
  process.env.PATH = `${env.binDir}:${origPath}`;
  process.env.SK_TEST = "1";
  try {
    return await fn();
  } finally {
    process.env.HOME = origHome;
    process.env.PATH = origPath;
    if (origWbTest === undefined) delete process.env.SK_TEST;
    else process.env.SK_TEST = origWbTest;
  }
}

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

/** Capture console.log/error and process.stdout.write output during fn execution. */
export async function captureOutput(fn: () => Promise<void>): Promise<CapturedOutput> {
  const logs: string[] = [];
  const errors: string[] = [];
  // Restore to suppressed noop after capture (not test-setup.ts mutes it)
  const prevLog = console.log;
  const prevError = console.error;
  const prevWrite = process.stdout.write.bind(process.stdout);

  console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: any[]) => errors.push(args.map(String).join(" "));
  process.stdout.write = ((chunk: any) => {
    logs.push(String(chunk));
    return true;
  }) as any;

  try {
    await fn();
  } finally {
    console.log = prevLog;
    console.error = prevError;
    process.stdout.write = prevWrite;
  }

  return {
    stdout: logs.join("\n"),
    stderr: errors.join("\n"),
  };
}

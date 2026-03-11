import { join } from "path";

// Re-export general test helpers from core
export {
  createTempRepo,
  writeWorkbenchJson,
  writeWbConfig,
  writeWbState,
  writePluginsTs,
  withTestEnv,
  captureOutput,
} from "../../core/__tests__/helpers";

const WB_PATH = join(import.meta.dir, "..", "stanok.ts");

interface WbResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TestEnv {
  home: string;
  repo: string;
  binDir: string;
  cleanup: () => void;
}

/** Run workbench CLI with custom HOME (isolates config). */
export async function wb(env: TestEnv, ...args: string[]): Promise<WbResult> {
  const proc = Bun.spawn(["bun", WB_PATH, ...args], {
    cwd: env.repo,
    env: {
      ...process.env,
      HOME: env.home,
      PATH: `${env.binDir}:${process.env.PATH}`,
      SK_TEST: "1",
      // Prevent interactive prompts
      CI: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** Run workbench CLI from a specific cwd. */
export async function wbAt(env: TestEnv, cwd: string, ...args: string[]): Promise<WbResult> {
  const proc = Bun.spawn(["bun", WB_PATH, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: env.home,
      PATH: `${env.binDir}:${process.env.PATH}`,
      SK_TEST: "1",
      CI: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

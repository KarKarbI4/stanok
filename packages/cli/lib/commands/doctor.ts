import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { skHome, readStateAsync } from "@stanok/core/config";

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

async function checkGit(): Promise<Check> {
  const result = await $`git --version`.quiet().nothrow();
  if (result.exitCode !== 0) return { label: "git", ok: false, detail: "not found" };
  const version = result.text().trim().replace("git version ", "");
  const [major, minor] = version.split(".").map(Number);
  const ok = major > 2 || (major === 2 && minor >= 15);
  return { label: "git", ok, detail: `${version}${ok ? "" : " (need >= 2.15)"}` };
}

async function checkBun(): Promise<Check> {
  const version = Bun.version;
  const [major, minor] = version.split(".").map(Number);
  const ok = major > 1 || (major === 1 && minor >= 2);
  return { label: "bun", ok, detail: `${version}${ok ? "" : " (need >= 1.2)"}` };
}

function checkDir(): Check {
  const home = skHome();
  const ok = existsSync(home);
  return { label: "~/.stanok/", ok, detail: ok ? "exists" : "missing — run sk init" };
}

function checkPlugins(): Check {
  const p = join(skHome(), "plugins.ts");
  const ok = existsSync(p);
  return { label: "plugins.ts", ok, detail: ok ? "exists" : "missing — see README" };
}

function checkAuth(): Check {
  const p = join(skHome(), "auth.json");
  if (!existsSync(p)) return { label: "auth.json", ok: false, detail: "missing — run sk login" };
  try {
    const data = JSON.parse(require("fs").readFileSync(p, "utf-8"));
    const count = Object.keys(data).length;
    return { label: "auth.json", ok: count > 0, detail: `${count} token(s)` };
  } catch {
    return { label: "auth.json", ok: false, detail: "invalid JSON" };
  }
}

async function checkRepos(): Promise<Check> {
  const state = await readStateAsync();
  const repos = state.repos || [];
  if (!repos.length) return { label: "repos", ok: false, detail: "none registered — run sk init" };
  const missing = repos.filter((r) => !existsSync(r));
  if (missing.length) {
    return { label: "repos", ok: false, detail: `${repos.length} registered, ${missing.length} missing on disk` };
  }
  return { label: "repos", ok: true, detail: `${repos.length} registered` };
}

export async function cmdDoctor() {
  const checks = await Promise.all([
    checkGit(),
    checkBun(),
    Promise.resolve(checkDir()),
    Promise.resolve(checkPlugins()),
    Promise.resolve(checkAuth()),
    checkRepos(),
  ]);

  console.log("Stanok doctor\n");
  let allOk = true;
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    const detail = c.detail ? ` — ${c.detail}` : "";
    console.log(`  ${icon} ${c.label}${detail}`);
    if (!c.ok) allOk = false;
  }
  console.log("");

  if (allOk) {
    console.log("All checks passed");
  } else {
    console.log("Some checks failed");
    process.exitCode = 1;
  }
}

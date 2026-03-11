import { existsSync, readFileSync } from "fs";
import { join } from "path";

interface CommandDef {
  desc: string;
  usage?: string;
  extra?: { usage: string; desc: string }[];
}

export const COMMANDS: Record<string, Record<string, CommandDef>> = {
  workflow: {
    start: { desc: "Start worktree", usage: "<TASK_ID> [--env KEY=VALUE] [options]" },
    c: { desc: "Commit with task ID prefix", usage: "<message>" },
    env: { desc: "Set/show env vars in worktree", usage: "[KEY=VALUE ...]" },
    ls: { desc: "List worktrees" },
  },
  git: {
    stop: { desc: "Stop worktree", usage: "<TASK_ID> [--remove]" },
    prune: { desc: "Remove merged worktrees" },
    mv: { desc: "Rename task (branch + worktree)", usage: "<OLD_ID> <NEW_ID>" },
    copy: { desc: "Re-sync copyFiles to worktree", usage: "[TASK_ID]" },
    run: { desc: "Run command in worktree context", usage: "<TASK_ID> <command...>" },
    pr: { desc: "Open PR or show build status", usage: "[--build]" },
    open: { desc: "Open worktree in Finder or terminal", usage: "[TASK_ID] [--terminal]" },
    diff: { desc: "Show diff from base branch", usage: "[TASK_ID] [--stat]" },
  },
  admin: {
    login: { desc: "Configure auth tokens" },
    init: { desc: "Register cwd as stanok repo" },
    config: { desc: "Show resolved configuration" },
    reload: { desc: "Regenerate settings schema" },
    schema: { desc: "Add settings schema to IDE", usage: "<vscode|cursor|jetbrains>" },
    auth: { desc: "Open auth.json in default editor" },
    doctor: { desc: "Check environment and configuration" },
    completions: { desc: "Generate shell completions", usage: "<zsh|bash|fish>" },
  },
};

export const TASK_ID_CMDS = ["start", "stop", "mv", "copy", "run", "open", "diff"];

/** Aliases that map to a primary command (e.g. "stand" → "env") */
export const ALIASES: Record<string, string> = { stand: "env" };

interface CachedCommand {
  desc: string;
  usage?: string;
  plugin: string;
}

function skHome(): string {
  return join(process.env.HOME!, ".stanok");
}

/** Read cached plugin commands from commands.json */
export function readCommandsCache(): Record<string, CachedCommand> {
  const cachePath = join(skHome(), "commands.json");
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8"));
  } catch {
    return {};
  }
}

export function printHelp() {
  console.log("Stanok — CLI for parallel worktree-based development\n");
  console.log("Usage:");
  for (const cmds of Object.values(COMMANDS)) {
    for (const [name, def] of Object.entries(cmds)) {
      const args = def.usage ? ` ${def.usage}` : "";
      const left = `  stanok ${name}${args}`;
      console.log(`${left.padEnd(54)}${def.desc}`);
      if (def.extra) {
        for (const e of def.extra) {
          const eLeft = `  stanok ${name} ${e.usage}`;
          console.log(`${eLeft.padEnd(54)}${e.desc}`);
        }
      }
    }
  }

  // Plugin commands from cache
  const cached = readCommandsCache();
  const entries = Object.entries(cached);
  if (entries.length) {
    console.log("\nExtensions:");
    for (const [name, cmd] of entries) {
      const args = cmd.usage ? ` ${cmd.usage}` : "";
      const left = `  stanok ${name}${args}`;
      console.log(`${left.padEnd(54)}${cmd.desc}`);
    }
  }
}

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { definePlugin } from "@stanok/core/plugin";

export const claude = definePlugin({
  name: "claude",
  settings: {},

  async postCreate(ctx) {
    // Symlink .claude/settings.local.json (not entire dir — CLAUDE.md is per-worktree)
    const claudeSource = join(ctx.repo, ".claude", "settings.local.json");
    const claudeDir = join(ctx.wtPath, ".claude");
    const claudeTarget = join(claudeDir, "settings.local.json");
    if (existsSync(claudeSource) && !existsSync(claudeTarget)) {
      mkdirSync(claudeDir, { recursive: true });
      await $`ln -s ${claudeSource} ${claudeTarget}`.quiet().nothrow();
      console.log("→ Symlinked .claude/settings.local.json");
    }

    // Symlink Claude Code project memory so all worktrees share one memory
    const home = Bun.env.HOME!;
    const claudeProjectsDir = join(home, ".claude", "projects");
    const toProjectId = (p: string) => p.replace(/\//g, "-");
    const repoMemory = join(claudeProjectsDir, toProjectId(ctx.repo), "memory");
    const wtMemory = join(claudeProjectsDir, toProjectId(ctx.wtPath), "memory");

    mkdirSync(repoMemory, { recursive: true });
    mkdirSync(join(claudeProjectsDir, toProjectId(ctx.wtPath)), { recursive: true });

    if (!existsSync(wtMemory)) {
      await $`ln -s ${repoMemory} ${wtMemory}`.quiet().nothrow();
      console.log("→ Symlinked Claude memory");
    }
  },
});

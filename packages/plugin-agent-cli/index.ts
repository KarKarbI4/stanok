import { existsSync } from "fs";
import { definePlugin } from "@stanok/core/plugin";

function itermSplit(title: string, cmd: string) {
  const script = `
tell application "iTerm"
  tell current session of current window
    set newSession to (split horizontally with default profile)
    tell newSession
      set name to "${title}"
      write text "${cmd}"
    end tell
  end tell
end tell`;
  Bun.spawnSync(["osascript", "-e", script]);
}

export const agentCli = definePlugin({
  name: "agent-cli",
  settings: {
    "agent-cli.terminal": "iterm" as "iterm" | "tmux",
    "agent-cli.binary": "",
    "agent-cli.args": [] as string[],
  },

  preStart(ctx, s) {
    if (!s["agent-cli.binary"] || !existsSync(ctx.wtPath)) return;
    const binary = s["agent-cli.binary"];
    const args = s["agent-cli.args"].length ? " " + s["agent-cli.args"].join(" ") : "";
    if (s["agent-cli.terminal"] === "tmux") {
      Bun.spawnSync(["tmux", "split-window", "-h", "-c", ctx.wtPath, `${binary}${args}`]);
      console.log(`→ Opened tmux pane for ${binary}`);
    } else {
      itermSplit(`[${ctx.taskId}] ${binary}`, `cd ${ctx.wtPath} && ${binary}${args}`);
      console.log(`→ Opened iTerm split for ${binary}`);
    }
  },
});

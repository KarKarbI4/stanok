import { existsSync } from "fs";
import { $ } from "bun";
import { definePlugin } from "@stanok/core/plugin";

const editorParts = (process.env.EDITOR || "").split(/\s+/).filter(Boolean);

export const ide = definePlugin({
  name: "ide",
  settings: {
    "ide.binary": editorParts[0] || "",
    "ide.args": editorParts.slice(1),
  },
  pruneIgnore: ["**/.cursor/**"],

  async preStart(ctx, s) {
    if (!s["ide.binary"] || !existsSync(ctx.wtPath)) return;
    await $`${s["ide.binary"]} ${ctx.wtPath} ${s["ide.args"]}`.quiet().nothrow();
    console.log(`→ Opened ${s["ide.binary"]}`);
  },
});

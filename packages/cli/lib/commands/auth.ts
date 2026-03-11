import { join } from "path";

export async function cmdAuth() {
  const authFile = join(Bun.env.HOME!, ".stanok", "auth.json");
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (editor) {
    const parts = editor.split(/\s+/);
    const proc = Bun.spawn([...parts, authFile], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } else {
    const { $ } = await import("bun");
    await $`open ${authFile}`;
  }
}

import { $ } from "bun";
import { basename, resolve } from "path";
import { definePlugin, type AuthResolver } from "@stanok/core/plugin";
import {
  detectRepo,
  taskIdUpper,
  taskIdLower,
  loadRepoConfig,
} from "@stanok/core/config";
import { WbError, currentBranch, taskIdFromBranch } from "@stanok/core/utils";

export const portless = definePlugin({
  name: "portless",
  settings: {},

  async preStop(ctx) {
    const lower = taskIdLower(ctx.taskId);
    await $`pkill -f ${"portless.*" + lower}`.quiet().nothrow();
  },

  commands: {
    port() {
      return {
        desc: "Show dev server port",
        usage: "[TASK_ID]",
        async run(args, cwd) {
          let taskId = args[0] || "";

          const dir = cwd || process.cwd();
          const repo = await detectRepo(dir);
          const rc = repo ? loadRepoConfig(repo) : undefined;
          const wb = rc?.workbench;

          if (!taskId) {
            try {
              const branch = await currentBranch(dir);
              const detected = taskIdFromBranch(branch, wb?.branchTemplate);
              if (detected) taskId = detected;
            } catch {}
          }

          let name: string;
          if (!taskId) {
            if (repo && resolve(dir) === resolve(repo)) {
              name = basename(dir);
            } else {
              throw new WbError("Usage: stanok port [TASK_ID]");
            }
          } else {
            name = taskIdLower(taskIdUpper(taskId));
          }

          const result = await $`portless list`.quiet().nothrow();
          const line = result.text().split("\n").find((l) => l.includes(name));
          if (!line) throw new WbError(`No active route for ${name}`);

          const match = line.match(/localhost:(\d+)\s+\(pid/);
          if (!match) throw new WbError(`Cannot parse port from: ${line.trim()}`);

          console.log(match[1]);
        },
      };
    },
  },
});

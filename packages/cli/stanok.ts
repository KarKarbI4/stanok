#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

function debugLog(...args: any[]) {
  try {
    const ts = new Date().toISOString();
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    appendFileSync(join(process.env.HOME!, ".stanok", "stanok.log"), `[${ts}] ${msg}\n`);
  } catch {}
}
import { WbError } from "@stanok/core/utils";
import { cmdStart } from "./lib/commands/start";
import { cmdStop } from "./lib/commands/stop";
import { cmdList } from "./lib/commands/list";
import { cmdEnv } from "./lib/commands/env";
import { cmdMv } from "./lib/commands/mv";
import { cmdCopy } from "./lib/commands/copy";
import { cmdCommit } from "./lib/commands/commit";
import { cmdRun } from "./lib/commands/run";
import { cmdPrune } from "./lib/commands/prune";
import { cmdPr } from "./lib/commands/pr";
import { cmdCompletions } from "./lib/commands/completions";
import { cmdConfig } from "./lib/commands/config-cmd";
import { cmdInit } from "./lib/commands/init";
import { cmdLogin } from "./lib/commands/login";
import { cmdReload } from "./lib/commands/reload";
import { cmdAuth } from "./lib/commands/auth";
import { cmdDoctor } from "./lib/commands/doctor";
import { cmdOpen } from "./lib/commands/open";
import { cmdDiff } from "./lib/commands/diff";
import { printHelp } from "./lib/commands";

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "login":
      await cmdLogin();
      break;
    case "init":
      await cmdInit();
      break;
    case "start":
      await cmdStart(args);
      break;
    case "ls":
      await cmdList(args);
      break;
    case "env":
    case "stand":
      await cmdEnv(args);
      break;
    case "stop":
      await cmdStop(args);
      break;
    case "prune":
      await cmdPrune(args);
      break;
    case "pr":
      await cmdPr(args);
      break;
    case "c":
      process.exit(await cmdCommit(args));
      break;
    case "mv":
      await cmdMv(args);
      break;
    case "copy":
      await cmdCopy(args);
      break;
    case "run":
      process.exit(await cmdRun(args));
      break;
    case "completions":
      await cmdCompletions(args);
      break;
    case "config":
      await cmdConfig();
      break;
    case "reload":
      await cmdReload();
      break;
    case "schema": {
      const { cmdSchema } = await import("./lib/commands/schema");
      await cmdSchema(args);
      break;
    }
    case "auth":
      await cmdAuth();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "open":
      await cmdOpen(args);
      break;
    case "diff":
      await cmdDiff(args);
      break;
    default: {
      // Try plugin commands from cache
      const skHome = join(process.env.HOME!, ".stanok");
      const cmdsCachePath = join(skHome, "commands.json");
      debugLog(`cmd=${cmd} cwd=${process.cwd()}`);
      if (cmd && existsSync(cmdsCachePath)) {
        try {
          const cached = JSON.parse(readFileSync(cmdsCachePath, "utf-8"));
          debugLog(`cached commands: ${Object.keys(cached).join(", ")}`);
          if (cached[cmd]) {
            const { detectRepo, loadRepoConfig, readConfigAsync, readStateAsync, loadPluginRegistry, findProjectRoot } = await import("@stanok/core/config");
            let repo = await detectRepo(process.cwd());
            debugLog(`detectRepo: ${repo}`);
            if (!repo) {
              const state = await readStateAsync();
              debugLog(`state.repos: ${state.repos}`);
              if (state.repos.length) repo = state.repos[0];
            }
            if (repo) {
              const rc = loadRepoConfig(repo);
              const config = await readConfigAsync();
              debugLog(`projectRoot: ${findProjectRoot(repo)}`);
              debugLog(`wb settings: ${JSON.stringify(Object.fromEntries(Object.entries(rc.workbench).filter(([k]) => k.includes("."))))}`);
              debugLog(`personal settings: ${JSON.stringify(Object.fromEntries(Object.entries(config).filter(([k]) => k.includes("."))))}`);
              const registry = await loadPluginRegistry(rc.workbench, config, repo);
              const pluginCmds = registry.commands();
              debugLog(`resolved commands: ${Object.keys(pluginCmds).join(", ") || "(none)"}`);
              if (pluginCmds[cmd]) {
                await pluginCmds[cmd].run(args);
                break;
              }
              debugLog(`command '${cmd}' not resolved by any plugin`);
              throw new WbError(`Command '${cmd}' (plugin: ${cached[cmd].plugin}) is not available. Check that the plugin is configured in .stanok/settings.json (e.g. jira.url, bitbucket.url) and auth is set up (stanok login).`);
            }
          }
        } catch (pluginErr) {
          debugLog(`plugin error: ${pluginErr}`);
          if (pluginErr instanceof WbError) throw pluginErr;
        }
      }
      printHelp();
      process.exit(1);
    }
  }
} catch (e) {
  if (e instanceof WbError) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

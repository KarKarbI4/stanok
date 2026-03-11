import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { info } from "@stanok/core/utils";

function skHome(): string {
  const dir = join(process.env.HOME!, ".stanok");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function inferJsonSchemaType(value: unknown): Record<string, any> {
  if (Array.isArray(value)) {
    if (value.length > 0) {
      return { type: "array", items: inferJsonSchemaType(value[0]) };
    }
    return { type: "array" };
  }
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    default:
      return {};
  }
}

const stringArray = { type: "array", items: { type: "string" } };

export async function cmdReload() {
  const pluginsFile = join(skHome(), "plugins.ts");

  // Build schema from plugin settings
  const pluginProperties: Record<string, any> = {};
  let defs: any[] = [];

  if (existsSync(pluginsFile)) {
    try {
      const mod = await import(pluginsFile);
      defs = mod.plugins;
      if (Array.isArray(defs)) {
        for (const def of defs) {
          if (!def?.settings) continue;
          for (const [key, defaultValue] of Object.entries(def.settings)) {
            pluginProperties[key] = {
              ...inferJsonSchemaType(defaultValue),
              default: defaultValue,
            };
          }
        }
      }
    } catch (e: any) {
      console.error(`plugins.ts failed to load: ${e.message}`);
    }
  }

  const schema: Record<string, any> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      $schema: { type: "string" },
      // Workbench project settings
      baseBranch: { type: "string", default: "master" },
      branchTemplate: { type: "string", default: "{task}" },
      proxyPort: { type: "number", default: 1355 },
      mergeDetection: { type: "string", default: "Pull request" },
      envFile: { type: "string", default: ".env.development.local" },
      pruneIgnore: stringArray,
      // Flat hooks
      "hooks.postCreate": stringArray,
      "hooks.preStart": stringArray,
      "hooks.postRemove": stringArray,
      // Flat copyFiles
      "copyFiles.include": stringArray,
      "copyFiles.exclude": stringArray,
      // Integration settings (built-in plugins)
      "jira.url": { type: "string" },
      "jira.project": { type: "string" },
      "jira.exploreIssues": { type: "string" },
      "bitbucket.url": { type: "string" },
      "bitbucket.repo": { type: "string" },
      "bamboo.url": { type: "string" },
      // User plugin settings
      ...pluginProperties,
    },
    additionalProperties: false,
  };

  const schemaJson = JSON.stringify(schema, null, 2) + "\n";
  const schemaPath = join(skHome(), "settings.schema.json");
  writeFileSync(schemaPath, schemaJson);
  info(`Generated ${schemaPath}`);

  // Generate commands.json from plugin commands
  const commandsMeta: Record<string, { desc: string; usage?: string; plugin: string }> = {};
  if (Array.isArray(defs)) {
    // We need auth + settings to call command factories
    const { getAuth } = await import("@stanok/core/auth");
    const { readConfigAsync, readStateAsync, loadRepoConfig, extractDotKeys } = await import("@stanok/core/config");

    const config = await readConfigAsync();
    const state = await readStateAsync();
    const repo = state.repos?.[0];
    const projectSettings = repo ? extractDotKeys(loadRepoConfig(repo).workbench) : {};
    const personalSettings = extractDotKeys(config);
    const auth = (url: string) => getAuth(url);

    for (const def of defs) {
      if (!def?.commands) continue;
      // Resolve settings for this plugin
      const resolved = { ...def.settings };
      for (const key of Object.keys(def.settings)) {
        if (key in projectSettings) resolved[key] = projectSettings[key];
        if (key in personalSettings) resolved[key] = personalSettings[key];
      }

      for (const [name, factory] of Object.entries(def.commands) as [string, Function][]) {
        const cmd = factory(resolved, auth);
        if (cmd) {
          commandsMeta[name] = { desc: cmd.desc, usage: cmd.usage, plugin: def.name };
        }
      }
    }
  }

  const commandsPath = join(skHome(), "commands.json");
  writeFileSync(commandsPath, JSON.stringify(commandsMeta, null, 2) + "\n");
  info(`Generated ${commandsPath}`);

  // Generate ui.json with status colors from plugins
  const uiConfig: Record<string, any> = {};
  if (Array.isArray(defs)) {
    const { readConfigAsync, readStateAsync, loadRepoConfig, extractDotKeys } = await import("@stanok/core/config");
    const { PluginRegistry } = await import("@stanok/core/registry");

    const config = await readConfigAsync();
    const state = await readStateAsync();
    const repo = state.repos?.[0];
    const projectSettings = repo ? extractDotKeys(loadRepoConfig(repo).workbench) : {};
    const personalSettings = extractDotKeys(config);
    const { getAuth } = await import("@stanok/core/auth");
    const auth = (url: string) => getAuth(url);

    const registry = new PluginRegistry(defs, projectSettings, personalSettings, auth);
    const colors = registry.statusColors();
    if (colors) uiConfig.statusColors = colors;
  }

  const uiPath = join(skHome(), "ui.json");
  writeFileSync(uiPath, JSON.stringify(uiConfig, null, 2) + "\n");
  info(`Generated ${uiPath}`);
}

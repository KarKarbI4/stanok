import {
  readConfigAsync,
  detectRepo,
  loadRepoConfig,
  loadPluginRegistry,
} from "@stanok/core/config";

export async function cmdConfig(cwd?: string) {
  const config = await readConfigAsync();
  const dir = cwd || process.cwd();
  const repo = await detectRepo(dir);

  const rc = repo ? loadRepoConfig(repo) : null;
  const wb = rc?.workbench;

  const hooks: Record<string, string[]> = {};
  for (const src of [wb, config]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (k.startsWith("hooks.") && Array.isArray(v) && v.length) {
        const hookName = k.slice("hooks.".length);
        hooks[hookName] = [...(hooks[hookName] || []), ...v];
      }
    }
  }

  const registry = await loadPluginRegistry(wb || {} as any, config);
  const allPlugins = registry.allPlugins();
  const pluginNames = allPlugins.map((p) => p.name);
  const pruneIgnore = [
    ...(wb?.pruneIgnore || []),
    ...allPlugins.flatMap((p) => p.pruneIgnore || []),
  ];

  const result: Record<string, any> = {
    repo: repo || null,
    baseBranch: wb?.baseBranch || null,
    branchTemplate: wb?.branchTemplate || null,
    proxyPort: wb?.proxyPort || null,
    mergeDetection: wb?.mergeDetection || null,
    plugins: pluginNames,
    hooks,
    copyFiles: wb?.["copyFiles.include"] ? { include: wb["copyFiles.include"], exclude: wb["copyFiles.exclude"] } : null,
    pruneIgnore,
  };

  console.log(JSON.stringify(result, null, 2));
}

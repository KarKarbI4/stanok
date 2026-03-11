import { loadRepoConfig, loadTracker } from "@stanok/core/config";
import { WbError, info, requireRepo, currentBranch, openUrl } from "@stanok/core/utils";

export async function cmdPr(args: string[], cwd?: string) {
  let showBuild = false;
  for (const arg of args) {
    if (arg === "--build") showBuild = true;
    else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
    else throw new WbError(`Unexpected argument: ${arg}`);
  }

  const branch = await currentBranch(cwd);
  const repo = await requireRepo(cwd);
  const rc = loadRepoConfig(repo);
  const { registry } = await loadTracker(repo);
  const codeHost = registry.codeHost;
  if (!codeHost) throw new WbError("No code host detected. Configure bitbucket settings in .stanok/settings.json or check git remote.");

  if (showBuild) {
    if (!codeHost.getBuildStatuses) throw new WbError("Code host does not support build statuses");
    const builds = await codeHost.getBuildStatuses(branch);
    if (!builds.length) throw new WbError("No builds found");

    const build = builds[0];
    const icon = build.state === "SUCCESSFUL" ? "✓" : build.state === "FAILED" ? "✗" : "●";
    console.error(`${icon} ${build.state}  ${build.name}`);
    console.error(`  ${build.url}`);

    if (codeHost.fetchBuildLog) {
      const log = await codeHost.fetchBuildLog(build.url);
      if (log) {
        console.log(log);
      } else {
        console.error("  (could not fetch build log)");
      }
    }

    if (build.state === "FAILED") throw new WbError("Build failed");
    return;
  }

  const pr = await codeHost.findOpenPR(branch);
  if (pr) {
    info(`Opening PR #${pr.id}`);
    await openUrl(pr.url);
    return;
  }

  info("No open PR found — opening create page");
  await openUrl(codeHost.createPRUrl(branch, rc.workbench.baseBranch));
}

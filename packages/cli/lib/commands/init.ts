import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import {
  readStateAsync,
  writeState,
} from "@stanok/core/config";
import { WbError, info } from "@stanok/core/utils";

function ensureGitignoreEntry(repoPath: string) {
  const gitignorePath = join(repoPath, ".gitignore");
  const entry = ".stanok/*.local*";

  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some(line => line.trim() === entry)) return;
  }

  const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${content}${newline}${entry}\n`);
  info(`Added ${entry} to .gitignore`);
}

export async function cmdInit(cwd?: string) {
  const repoPath = resolve(cwd || process.cwd());
  if (!existsSync(join(repoPath, ".git"))) {
    throw new WbError(`${repoPath} is not a git repository`);
  }

  const state = await readStateAsync();
  const repos = new Set(state.repos);
  repos.add(repoPath);
  await writeState({ repos: [...repos] });
  info(`Registered repo: ${repoPath}`);

  // Create .stanok/ directory
  const stanokDir = join(repoPath, ".stanok");
  mkdirSync(stanokDir, { recursive: true });

  // Add .stanok/*.local* to .gitignore
  ensureGitignoreEntry(repoPath);

  // Offer to create settings.json if missing
  const settingsPath = join(stanokDir, "settings.json");
  if (!existsSync(settingsPath)) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string, defaultVal?: string): Promise<string> =>
      new Promise((resolve) => {
        const suffix = defaultVal ? ` [${defaultVal}]` : "";
        rl.question(`${prompt}${suffix}: `, (answer: string) => {
          resolve(answer.trim() || defaultVal || "");
        });
      });

    try {
      const create = await ask("No .stanok/settings.json found. Create? (Y/n)", "Y");
      if (create.toLowerCase() === "n") return;

      const { detectPackageManager } = await import("@stanok/core/project");
      const detected = detectPackageManager(repoPath);

      const bbUrl = await ask("Bitbucket URL (or empty to skip)");
      const bbRepo = bbUrl ? await ask("Bitbucket repo (projects/X/repos/Y)") : "";
      const baseBranch = await ask("Base branch", "master");
      const branchTemplate = await ask("Branch template", "{task}");
      console.log(`  Package manager: ${detected} (detected)`);
      const jiraUrl = await ask("Jira URL (or empty to skip)");
      const jiraProject = jiraUrl ? await ask("Jira project key") : "";

      const wbConfig: any = {};

      if (baseBranch !== "master") wbConfig.baseBranch = baseBranch;
      if (branchTemplate !== "{task}") wbConfig.branchTemplate = branchTemplate;

      if (jiraUrl && jiraProject) {
        wbConfig["jira.url"] = jiraUrl;
        wbConfig["jira.project"] = jiraProject;
      }

      if (bbUrl && bbRepo) {
        wbConfig["bitbucket.url"] = bbUrl;
        wbConfig["bitbucket.repo"] = bbRepo;
      }

      writeFileSync(settingsPath, JSON.stringify(wbConfig, null, 2) + "\n");
      info("Created .stanok/settings.json");
    } finally {
      rl.close();
    }
  }
}

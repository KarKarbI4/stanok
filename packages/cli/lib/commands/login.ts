import { detectRepo, loadRepoConfig } from "@stanok/core/config";
import { getAuth, setAuth } from "@stanok/core/auth";
import { JiraClient } from "@stanok/core/jira";
import { info, tokenHint } from "@stanok/core/utils";

export async function cmdLogin(cwd?: string) {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const askHidden = (prompt: string, hasExisting: boolean): Promise<string> =>
    new Promise((resolve) => {
      const suffix = hasExisting ? " [••••••••]" : "";
      process.stdout.write(`${prompt}${suffix}: `);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);

      let input = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
          resolve(input);
        } else if (c === "\x7f" || c === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (c === "\x03") {
          process.exit(130);
        } else {
          input += c;
          process.stdout.write("•");
        }
      };
      stdin.on("data", onData);
    });

  try {
    const dir = cwd || process.cwd();
    const repo = await detectRepo(dir);
    const rc = repo ? loadRepoConfig(repo) : undefined;
    const jiraUrl = rc?.workbench["jira.url"] as string | undefined;
    const bbUrl = rc?.workbench["bitbucket.url"] as string | undefined;
    const bambooUrl = rc?.workbench["bamboo.url"] as string | undefined;

    // ── Jira ──
    if (jiraUrl) {
      const existing = getAuth(jiraUrl);
      console.log(`\n── Jira (${jiraUrl}) ──\n`);

      const jiraToken = await askHidden("  PAT", !!existing?.token);
      const effectiveToken = jiraToken || existing?.token || "";

      if (effectiveToken) {
        try {
          const client = new JiraClient(jiraUrl, effectiveToken);
          const me = await client.myself();
          info(`Authenticated as ${me.displayName} (${me.name})`);
        } catch (e: any) {
          console.error(`  Authentication failed: ${e.message}`);
        }
      }

      setAuth(jiraUrl, { token: effectiveToken });
    } else {
      console.log("\n  (No Jira configured — skipping)");
    }

    // ── Bitbucket ──
    if (bbUrl) {
      const existing = getAuth(bbUrl);
      console.log(`\n── Bitbucket (${bbUrl}) ──\n`);

      const bbToken = await askHidden("  Token", !!existing?.token);
      if (bbToken) setAuth(bbUrl, { token: bbToken });
    } else {
      console.log("\n  (No Bitbucket configured — skipping)");
    }

    // ── Bamboo ──
    if (bambooUrl) {
      const existing = getAuth(bambooUrl);
      console.log(`\n── Bamboo (${bambooUrl}) ──\n`);

      const bambooToken = await askHidden("  Token", !!existing?.token);
      if (bambooToken) setAuth(bambooUrl, { token: bambooToken });
    }

    console.log("\n✓ Authentication saved to ~/.stanok/auth.json\n");
  } finally {
    rl.close();
  }
}

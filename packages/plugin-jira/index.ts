// ─── Jira Plugin ────────────────────────────────────────────────────────────
// Provides `issueTracker` service + CLI commands.

import { definePlugin, type AuthResolver } from "@stanok/core/plugin";
import type { Issue, IssueTracker } from "@stanok/core/services";
import { JiraClient } from "@stanok/core/jira";
import {
  detectRepo,
  readStateAsync,
  taskIdUpper,
  loadRepoConfig,
  listTasks,
} from "@stanok/core/config";
import { WbError, info, currentBranch, taskIdFromBranch, openUrl } from "@stanok/core/utils";

async function resolveExploreJql(client: JiraClient, exploreIssues: string): Promise<string | null> {
  if (!exploreIssues) return null;

  let url: URL;
  try {
    url = new URL(exploreIssues);
  } catch {
    return exploreIssues; // raw JQL
  }

  // URL with ?jql= param (e.g. /issues/?jql=...)
  const jqlParam = url.searchParams.get("jql");
  if (jqlParam) return jqlParam;

  // RapidBoard URL (e.g. RapidBoard.jspa?rapidView=123&quickFilter=456)
  const rapidView = url.searchParams.get("rapidView");
  if (rapidView) {
    let jql = await client.getBoardFilterJql(rapidView);
    const quickFilter = url.searchParams.get("quickFilter");
    if (quickFilter) {
      const qfJql = await client.getQuickFilterJql(rapidView, quickFilter);
      if (qfJql) jql = `(${jql}) AND (${qfJql})`;
    }
    return jql;
  }

  // URL with ?filter= param
  const filter = url.searchParams.get("filter");
  if (filter) return `filter = ${filter}`;

  return null;
}

class JiraIssueTracker implements IssueTracker {
  constructor(
    private client: JiraClient,
    private baseUrl: string,
    private exploreIssues: string = "",
  ) {}

  async getIssue(key: string): Promise<Issue> {
    const raw = await this.client.getIssue(key);
    const f = raw.fields;
    return {
      key: raw.key,
      summary: f.summary || "",
      status: f.status?.name || "Unknown",
      type: f.issuetype?.name,
      priority: f.priority?.name,
      assignee: f.assignee?.displayName,
      description: f.description,
      fields: f,
    };
  }

  async search(query: string, maxResults?: number): Promise<Issue[]> {
    const result = await this.client.search(query, ["summary", "status", "issuetype", "priority", "assignee"], maxResults);
    return result.issues.map((raw) => {
      const f = raw.fields;
      return {
        key: raw.key,
        summary: f.summary || "",
        status: f.status?.name || "Unknown",
        type: f.issuetype?.name,
        priority: f.priority?.name,
        assignee: f.assignee?.displayName,
        description: f.description,
        fields: f,
      };
    });
  }

  async myself(): Promise<{ name: string; displayName: string }> {
    return this.client.myself();
  }

  issueUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  async addWorklog(key: string, time: string, comment?: string): Promise<void> {
    await this.client.addWorklog(key, time, comment);
  }

  async myIssues(): Promise<Issue[]> {
    const jql = await resolveExploreJql(this.client, this.exploreIssues)
      ?? `assignee = currentUser() AND sprint in openSprints() AND status not in (Done, Closed, Resolved) ORDER BY status ASC, updated DESC`;
    return this.search(jql, 30);
  }

  async batchGet(keys: string[]): Promise<Issue[]> {
    if (!keys.length) return [];
    const jql = `key in (${keys.join(",")})`;
    return this.search(jql, keys.length);
  }
}

export const jiraPlugin = definePlugin({
  name: "jira",
  settings: {
    "jira.url": "",
    "jira.project": "",
    "jira.exploreIssues": "",
  },
  provides: {
    issueTracker(settings, auth) {
      const url = settings["jira.url"];
      if (!url) return null;
      const a = auth(url);
      if (!a) return null;
      return new JiraIssueTracker(new JiraClient(url, a.token), url, settings["jira.exploreIssues"]);
    },
  },

  async enrich(tasks, settings, auth) {
    const url = settings["jira.url"];
    if (!url) return;
    const a = auth(url);
    if (!a) return;
    const client = new JiraClient(url, a.token);
    const tracker = new JiraIssueTracker(client, url, settings["jira.exploreIssues"]);
    const keys = tasks.map((t) => t.task_id);
    if (!keys.length) return;
    const issues = await tracker.batchGet(keys);
    const map = new Map(issues.map((i) => [i.key, i]));
    for (const t of tasks) {
      const issue = map.get(t.task_id);
      if (issue) {
        t.summary = issue.summary;
        t.status = issue.status;
      }
    }
  },

  commands: {
    issue(settings, auth) {
      const url = settings["jira.url"];
      if (!url) return null;
      const a = auth(url);
      if (!a) return null;

      return {
        desc: "Show issue info / open in browser",
        usage: "[TASK_ID] [--text] [--my] [--format=json]",
        async run(args, cwd) {
          let taskIds: string[] = [];
          let showText = false;
          let showMy = false;
          let formatJson = false;

          for (const arg of args) {
            if (arg === "--text") showText = true;
            else if (arg === "--my") showMy = true;
            else if (arg === "--format=json") formatJson = true;
            else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
            else taskIds.push(arg);
          }

          const dir = cwd || process.cwd();
          let repo = await detectRepo(dir);
          if (!repo) {
            const state = await readStateAsync();
            if (state.repos.length) repo = state.repos[0];
          }
          const rc = repo ? loadRepoConfig(repo) : undefined;
          const wb = rc?.workbench;

          if (!taskIds.length && !showMy) {
            try {
              const branch = await currentBranch(dir);
              const detected = taskIdFromBranch(branch, wb?.branchTemplate);
              if (!detected) throw new WbError(`Cannot detect task ID from branch '${branch}'. Usage: stanok issue <TASK_ID>`);
              taskIds.push(detected);
            } catch (e) {
              if (e instanceof WbError) throw e;
              throw new WbError("Not in a git repository. Usage: stanok issue <TASK_ID>");
            }
          }

          const tracker = new JiraIssueTracker(new JiraClient(url, a!.token), url, settings["jira.exploreIssues"]);

          // ── --my: list my issues ──
          if (showMy) {
            const issues = await tracker.myIssues();
            if (formatJson) {
              console.log(JSON.stringify(issues.map((i) => ({
                key: i.key, summary: i.summary, status: i.status,
              }))));
            } else {
              if (!issues.length) {
                console.log("No issues assigned to you in active sprint");
                return;
              }
              for (const i of issues) {
                console.log(`  ${i.key.padEnd(16)} ${i.status.padEnd(16)} ${i.summary}`);
              }
            }
            return;
          }

          // ── Batch mode ──
          if (taskIds.length > 1 || (taskIds.length === 1 && taskIds[0].includes(","))) {
            const keys = taskIds.flatMap((id) => id.split(",")).map(taskIdUpper).filter(Boolean);
            if (!keys.length) throw new WbError("No task IDs provided");

            const issues = await tracker.batchGet(keys);
            if (formatJson) {
              console.log(JSON.stringify(issues.map((i) => ({
                key: i.key, summary: i.summary, status: i.status,
              }))));
            } else {
              for (const i of issues) {
                console.log(`  ${i.key.padEnd(16)} ${i.status.padEnd(16)} ${i.summary}`);
              }
            }
            return;
          }

          // ── Single key mode ──
          const taskId = taskIdUpper(taskIds[0]);

          if (showText || formatJson) {
            try {
              const issue = await tracker.getIssue(taskId);
              if (formatJson) {
                console.log(JSON.stringify([{
                  key: issue.key, summary: issue.summary, status: issue.status,
                }]));
              } else {
                console.log("");
                console.log(`  ${issue.key}: ${issue.summary}`);
                console.log(`  Status:   ${issue.status}`);
                console.log(`  Type:     ${issue.type || "?"}`);
                console.log(`  Priority: ${issue.priority || "?"}`);
                console.log(`  Assignee: ${issue.assignee || "Unassigned"}`);
                if (issue.description) {
                  console.log(`  ──────────`);
                  const desc = issue.description.length > 500
                    ? issue.description.slice(0, 500) + "..."
                    : issue.description;
                  console.log(`  ${desc}`);
                }
                console.log("");
              }
            } catch (e: any) {
              throw new WbError(`Could not fetch issue: ${e.message}`);
            }
            return;
          }

          // Default: open in browser
          const issueUrl = tracker.issueUrl(taskId);
          info(`Opening ${issueUrl}`);
          await openUrl(issueUrl);
        },
      };
    },

    issues(settings, auth) {
      const url = settings["jira.url"];
      if (!url) return null;
      const a = auth(url);
      if (!a) return null;

      return {
        desc: "My issues from tracker",
        usage: "[--format=json]",
        async run(args) {
          let formatJson = false;

          for (const arg of args) {
            if (arg === "--format=json") formatJson = true;
            else if (arg.startsWith("-")) throw new WbError(`Unknown option: ${arg}`);
          }

          const tracker = new JiraIssueTracker(new JiraClient(url, a!.token), url, settings["jira.exploreIssues"]);
          const [issues, existingTasks] = await Promise.all([
            tracker.myIssues(),
            listTasks(),
          ]);

          const existingIds = new Set(existingTasks.map((t) => t.task_id));

          if (formatJson) {
            console.log(JSON.stringify(issues.map((i) => ({
              key: i.key,
              summary: i.summary,
              status: i.status,
              has_workbench: existingIds.has(i.key),
            }))));
            return;
          }

          if (!issues.length) {
            console.log("No issues assigned to you in active sprint");
            return;
          }

          console.log(
            [
              "".padEnd(3),
              "TASK".padEnd(16),
              "STATUS".padEnd(16),
              "SUMMARY",
            ].join(" "),
          );
          console.log(
            [
              "".padEnd(3),
              "────".padEnd(16),
              "──────".padEnd(16),
              "───────",
            ].join(" "),
          );

          for (const i of issues) {
            const marker = existingIds.has(i.key) ? " ●" : "  ";
            console.log(
              [
                marker.padEnd(3),
                i.key.padEnd(16),
                i.status.padEnd(16),
                i.summary,
              ].join(" "),
            );
          }
        },
      };
    },
  },
});

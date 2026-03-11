import { describe, expect, test, mock } from "bun:test";
import { jiraPlugin } from "../index";
import type { AuthResolver } from "@stanok/core/plugin";
import type { IssueTracker } from "@stanok/core/services";

const auth: AuthResolver = (url) => ({ token: "test-token" });
const noAuth: AuthResolver = () => null;

describe("JiraIssueTracker via plugin provides", () => {
  const settings = {
    "jira.url": "http://jira.test",
    "jira.project": "TEST",
    "jira.exploreIssues": "",
  };

  test("creates tracker when url and auth present", () => {
    const tracker = jiraPlugin.provides!.issueTracker(
      settings,
      auth
    ) as IssueTracker;
    expect(tracker).not.toBeNull();
    expect(tracker.issueUrl("TEST-1")).toBe("http://jira.test/browse/TEST-1");
  });

  test("returns null when no url", () => {
    const result = jiraPlugin.provides!.issueTracker(
      { ...settings, "jira.url": "" },
      auth
    );
    expect(result).toBeNull();
  });

  test("returns null when no auth", () => {
    const result = jiraPlugin.provides!.issueTracker(settings, noAuth);
    expect(result).toBeNull();
  });

  test("getIssue maps fields correctly", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/issue/TEST-1")) {
        return new Response(
          JSON.stringify({
            key: "TEST-1",
            fields: {
              summary: "Bug fix",
              status: { name: "Open" },
              issuetype: { name: "Bug" },
              priority: { name: "High" },
              assignee: { displayName: "Alice" },
              description: "Fix this",
            },
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const tracker = jiraPlugin.provides!.issueTracker(
      settings,
      auth
    ) as IssueTracker;
    const issue = await tracker.getIssue("TEST-1");
    expect(issue.key).toBe("TEST-1");
    expect(issue.summary).toBe("Bug fix");
    expect(issue.status).toBe("Open");
    expect(issue.type).toBe("Bug");
    expect(issue.priority).toBe("High");
    expect(issue.assignee).toBe("Alice");
    expect(issue.description).toBe("Fix this");

    globalThis.fetch = origFetch;
  });

  test("addWorklog is defined", async () => {
    const tracker = jiraPlugin.provides!.issueTracker(
      settings,
      auth
    ) as IssueTracker;
    expect(tracker.addWorklog).toBeDefined();
  });
});

describe("myIssues with exploreIssues", () => {
  function mockFetchForSearch(expectedJql: string) {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/search")) {
        expect(decodeURIComponent(url)).toContain(expectedJql);
        return new Response(
          JSON.stringify({
            issues: [
              { key: "T-1", fields: { summary: "Found", status: { name: "Open" } } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;
    return origFetch;
  }

  test("empty exploreIssues uses default JQL", async () => {
    const origFetch = mockFetchForSearch("assignee = currentUser()");
    const tracker = jiraPlugin.provides!.issueTracker(
      { "jira.url": "http://jira.test", "jira.project": "TEST", "jira.exploreIssues": "" },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    globalThis.fetch = origFetch;
  });

  test("raw JQL string is used directly", async () => {
    const origFetch = mockFetchForSearch("project = ABC");
    const tracker = jiraPlugin.provides!.issueTracker(
      { "jira.url": "http://jira.test", "jira.project": "TEST", "jira.exploreIssues": "project = ABC" },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    globalThis.fetch = origFetch;
  });

  test("URL with ?jql= param extracts JQL", async () => {
    const origFetch = mockFetchForSearch("status = Open");
    const tracker = jiraPlugin.provides!.issueTracker(
      {
        "jira.url": "http://jira.test",
        "jira.project": "TEST",
        "jira.exploreIssues": "http://jira.test/issues/?jql=status%20%3D%20Open",
      },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    globalThis.fetch = origFetch;
  });

  test("URL with ?filter= param becomes filter JQL", async () => {
    const origFetch = mockFetchForSearch("filter = 12345");
    const tracker = jiraPlugin.provides!.issueTracker(
      {
        "jira.url": "http://jira.test",
        "jira.project": "TEST",
        "jira.exploreIssues": "http://jira.test/issues/?filter=12345",
      },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    globalThis.fetch = origFetch;
  });

  test("RapidBoard URL resolves board filter JQL", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      // Board configuration → returns filter ID
      if (url.includes("/rest/agile/1.0/board/9541/configuration")) {
        return new Response(
          JSON.stringify({ filter: { id: "1001" } }),
          { status: 200 }
        );
      }
      // Filter → returns JQL
      if (url.includes("/rest/api/2/filter/1001")) {
        return new Response(
          JSON.stringify({ jql: "project = BOARD" }),
          { status: 200 }
        );
      }
      // Search with resolved JQL
      if (url.includes("/search")) {
        expect(decodeURIComponent(url)).toContain("project = BOARD");
        return new Response(
          JSON.stringify({
            issues: [
              { key: "BOARD-1", fields: { summary: "Board issue", status: { name: "Open" } } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const tracker = jiraPlugin.provides!.issueTracker(
      {
        "jira.url": "http://jira.test",
        "jira.project": "TEST",
        "jira.exploreIssues": "http://jira.test/secure/RapidBoard.jspa?rapidView=9541",
      },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("BOARD-1");
    globalThis.fetch = origFetch;
  });

  test("RapidBoard URL with quickFilter combines JQLs", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/rest/agile/1.0/board/9541/configuration")) {
        return new Response(
          JSON.stringify({ filter: { id: "1001" } }),
          { status: 200 }
        );
      }
      if (url.includes("/rest/api/2/filter/1001")) {
        return new Response(
          JSON.stringify({ jql: "project = BOARD" }),
          { status: 200 }
        );
      }
      if (url.includes("/rest/greenhopper/1.0/rapidviewconfig/editmodel.json")) {
        return new Response(
          JSON.stringify({
            rapidListConfig: {
              quickFilters: [
                { id: 25870, query: "assignee = currentUser()" },
                { id: 99999, query: "other filter" },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/search")) {
        const decoded = decodeURIComponent(url);
        expect(decoded).toContain("(project = BOARD) AND (assignee = currentUser())");
        return new Response(
          JSON.stringify({
            issues: [
              { key: "BOARD-2", fields: { summary: "Filtered", status: { name: "In Progress" } } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const tracker = jiraPlugin.provides!.issueTracker(
      {
        "jira.url": "http://jira.test",
        "jira.project": "TEST",
        "jira.exploreIssues": "http://jira.test/secure/RapidBoard.jspa?rapidView=9541&quickFilter=25870",
      },
      auth
    ) as IssueTracker;
    const issues = await tracker.myIssues!();
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("BOARD-2");
    globalThis.fetch = origFetch;
  });
});

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { JiraClient } from "../jira";

const BASE_URL = "https://jira.example.com";
const TOKEN = "test-token-123";

let originalFetch: typeof globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockFetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  );
  globalThis.fetch = mockFetch as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastFetchCall(): { url: string; init: RequestInit } {
  const calls = mockFetch.mock.calls;
  const last = calls[calls.length - 1];
  return { url: last[0] as string, init: last[1] as RequestInit };
}

describe("JiraClient", () => {
  let client: JiraClient;

  beforeEach(() => {
    client = new JiraClient(BASE_URL, TOKEN);
  });

  describe("getIssue", () => {
    test("sends GET to correct URL with auth header", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ key: "TEST-1", fields: { summary: "Test issue" } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const issue = await client.getIssue("TEST-1");
      const { url, init } = lastFetchCall();

      expect(url).toBe(`${BASE_URL}/rest/api/2/issue/TEST-1`);
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      );
      expect(issue.key).toBe("TEST-1");
    });
  });

  describe("search", () => {
    test("encodes JQL in URL", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ issues: [] }), { status: 200 }),
        ),
      );

      await client.search("project = TEST AND status = Open", ["summary", "status"]);
      const { url } = lastFetchCall();

      expect(url).toContain("/rest/api/2/search?jql=");
      expect(url).toContain(encodeURIComponent("project = TEST AND status = Open"));
      expect(url).toContain("fields=summary,status");
    });

    test("uses default fields and maxResults", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ issues: [] }), { status: 200 }),
        ),
      );

      await client.search("key = TEST-1");
      const { url } = lastFetchCall();

      expect(url).toContain("fields=summary");
      expect(url).toContain("maxResults=50");
    });
  });

  describe("addWorklog", () => {
    test("sends timeSpent in body", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 204 })),
      );

      await client.addWorklog("TEST-1", "2h", "Worked on feature");
      const { url, init } = lastFetchCall();

      expect(url).toBe(`${BASE_URL}/rest/api/2/issue/TEST-1/worklog`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.timeSpent).toBe("2h");
      expect(body.comment).toBe("Worked on feature");
    });

    test("omits comment when not provided", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 204 })),
      );

      await client.addWorklog("TEST-1", "30m");
      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.timeSpent).toBe("30m");
      expect(body.comment).toBeUndefined();
    });
  });

  describe("createIssue", () => {
    test("sends correct request body", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ key: "TEST-99", id: "10099" }), { status: 201 }),
        ),
      );

      await client.createIssue({
        projectKey: "TEST",
        summary: "New bug",
        description: "Something broke",
        labels: ["frontend"],
        priority: "High",
      });

      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.fields.project.key).toBe("TEST");
      expect(body.fields.summary).toBe("New bug");
      expect(body.fields.issuetype.name).toBe("Bug");
      expect(body.fields.labels).toEqual(["frontend"]);
      expect(body.fields.priority.name).toBe("High");
    });
  });

  describe("error handling", () => {
    test("401 throws with status", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
      );

      try {
        await client.getIssue("TEST-1");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(e.status).toBe(401);
        expect(e.message).toContain("401");
      }
    });

    test("404 throws with status", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Not Found", { status: 404 })),
      );

      try {
        await client.getIssue("NONEXIST-1");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(e.status).toBe(404);
      }
    });
  });

  describe("myself", () => {
    test("returns user info", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ name: "jdoe", displayName: "John Doe" }),
            { status: 200 },
          ),
        ),
      );

      const user = await client.myself();
      expect(user.name).toBe("jdoe");
      expect(user.displayName).toBe("John Doe");
    });
  });

  describe("updateFields", () => {
    test("sends PUT with fields", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 204 })),
      );

      await client.updateFields("TEST-1", { customfield_100: { value: "Team A" } });
      const { url, init } = lastFetchCall();
      expect(url).toBe(`${BASE_URL}/rest/api/2/issue/TEST-1`);
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string);
      expect(body.fields.customfield_100.value).toBe("Team A");
    });
  });

  describe("assign", () => {
    test("sends PUT to assignee endpoint", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 204 })),
      );

      await client.assign("TEST-1", "jdoe");
      const { url, init } = lastFetchCall();
      expect(url).toBe(`${BASE_URL}/rest/api/2/issue/TEST-1/assignee`);
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string);
      expect(body.name).toBe("jdoe");
    });
  });

  describe("addLabel", () => {
    test("sends PUT with update labels add", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 204 })),
      );

      await client.addLabel("TEST-1", "frontend");
      const { url, init } = lastFetchCall();
      expect(url).toBe(`${BASE_URL}/rest/api/2/issue/TEST-1`);
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string);
      expect(body.update.labels).toEqual([{ add: "frontend" }]);
    });
  });

  describe("createIssue branches", () => {
    test("without priority/labels/assignee", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ key: "TEST-10", id: "100" }), { status: 201 }),
        ),
      );

      const result = await client.createIssue({
        projectKey: "TEST",
        summary: "Simple issue",
        description: "Desc",
      });
      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.fields.priority).toBeUndefined();
      expect(body.fields.labels).toBeUndefined();
      expect(body.fields.assignee).toBeUndefined();
      expect(result.key).toBe("TEST-10");
    });

    test("with assignee", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ key: "TEST-11", id: "101" }), { status: 201 }),
        ),
      );

      await client.createIssue({
        projectKey: "TEST",
        summary: "Assigned issue",
        description: "Desc",
        assignee: "jdoe",
      });
      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.fields.assignee.name).toBe("jdoe");
    });

    test("with components", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ key: "TEST-12", id: "102" }), { status: 201 }),
        ),
      );

      await client.createIssue({
        projectKey: "TEST",
        summary: "With components",
        description: "Desc",
        components: [{ id: "100" }],
      });
      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.fields.components).toEqual([{ id: "100" }]);
    });

    test("with customFields", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ key: "TEST-13", id: "103" }), { status: 201 }),
        ),
      );

      await client.createIssue({
        projectKey: "TEST",
        summary: "Custom fields",
        description: "Desc",
        customFields: { customfield_100: "val" },
      });
      const { init } = lastFetchCall();
      const body = JSON.parse(init.body as string);
      expect(body.fields.customfield_100).toBe("val");
    });
  });
});

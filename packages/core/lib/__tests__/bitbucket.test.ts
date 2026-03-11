import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { BitbucketClient } from "../bitbucket";

const BASE_URL = "https://bitbucket.example.com";
const PROJECT = "UI";
const REPO = "general_mp3";
const TOKEN = "bb-token-123";

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

describe("BitbucketClient", () => {
  let client: BitbucketClient;

  beforeEach(() => {
    client = new BitbucketClient(BASE_URL, PROJECT, REPO, TOKEN);
  });

  describe("repoUrl", () => {
    test("builds correct URL", () => {
      expect(client.repoUrl()).toBe(
        `${BASE_URL}/projects/${PROJECT}/repos/${REPO}`,
      );
    });
  });

  describe("createPRUrl", () => {
    test("builds URL with source and target branches", () => {
      const url = client.createPRUrl("feature/TEST-1", "master");
      expect(url).toContain(`/pull-requests?create`);
      expect(url).toContain("sourceBranch=refs/heads/feature/TEST-1");
      expect(url).toContain("targetBranch=refs/heads/master");
    });

    test("defaults target to master", () => {
      const url = client.createPRUrl("feature/TEST-1");
      expect(url).toContain("targetBranch=refs/heads/master");
    });
  });

  describe("prOverviewUrl", () => {
    test("builds PR overview URL", () => {
      expect(client.prOverviewUrl(42)).toBe(
        `${BASE_URL}/projects/${PROJECT}/repos/${REPO}/pull-requests/42/overview`,
      );
    });
  });

  describe("findOpenPR", () => {
    test("sends correct request for branch", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              values: [
                { id: 123, title: "TEST-1: Fix", state: "OPEN", links: { self: [{ href: "" }] } },
              ],
            }),
            { status: 200 },
          ),
        ),
      );

      const pr = await client.findOpenPR("feature/TEST-1");
      const { url, init } = lastFetchCall();

      expect(url).toContain("/rest/api/1.0/projects/UI/repos/general_mp3/pull-requests");
      expect(url).toContain("state=OPEN");
      expect(url).toContain("at=refs/heads/feature/TEST-1");
      expect(url).toContain("direction=OUTGOING");
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      );
      expect(pr?.id).toBe(123);
    });

    test("returns null when no PR found", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ values: [] }), { status: 200 }),
        ),
      );

      const pr = await client.findOpenPR("feature/NONEXIST-1");
      expect(pr).toBeNull();
    });
  });

  describe("createPR", () => {
    test("sends correct request body", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 456,
              title: "TEST-1: Feature",
              state: "OPEN",
              links: { self: [{ href: "" }] },
            }),
            { status: 201 },
          ),
        ),
      );

      const pr = await client.createPR(
        "TEST-1: Feature",
        "feature/TEST-1",
        "master",
        "Description here",
      );

      const { url, init } = lastFetchCall();
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.title).toBe("TEST-1: Feature");
      expect(body.fromRef.id).toBe("refs/heads/feature/TEST-1");
      expect(body.toRef.id).toBe("refs/heads/master");
      expect(body.description).toBe("Description here");
      expect(pr.id).toBe(456);
    });
  });

  describe("getBuildStatuses", () => {
    test("uses commit hash in URL", async () => {
      const commitHash = "abc123def456";
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              values: [
                {
                  state: "SUCCESSFUL",
                  key: "build-1",
                  name: "CI Build",
                  url: "https://bamboo.example.com/browse/BUILD-1",
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      );

      const statuses = await client.getBuildStatuses(commitHash);
      const { url } = lastFetchCall();

      expect(url).toBe(
        `${BASE_URL}/rest/build-status/1.0/commits/${commitHash}`,
      );
      expect(statuses).toHaveLength(1);
      expect(statuses[0].state).toBe("SUCCESSFUL");
    });

    test("returns empty array on error", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 404 })),
      );

      const statuses = await client.getBuildStatuses("deadbeef");
      expect(statuses).toEqual([]);
    });
  });

  describe("error handling", () => {
    test("401 throws with status", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401 })),
      );

      try {
        await client.findOpenPR("feature/TEST-1");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(e.status).toBe(401);
      }
    });

    test("403 throws with status", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Forbidden", { status: 403 })),
      );

      try {
        await client.findOpenPR("feature/TEST-1");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(e.status).toBe(403);
      }
    });

    test("createPR throws on non-OK response", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ errors: [{ message: "Conflict" }] }), { status: 409 }),
        ),
      );

      try {
        await client.createPR("Title", "feature/X", "master");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(e.status).toBe(409);
        expect(e.message).toContain("409");
      }
    });
  });

  describe("getLatestCommit", () => {
    test("returns commit hash", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ values: [{ id: "abc123" }] }),
            { status: 200 },
          ),
        ),
      );

      const hash = await client.getLatestCommit("feature/TEST-1");
      expect(hash).toBe("abc123");
    });

    test("returns null when no commits", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ values: [] }), { status: 200 }),
        ),
      );

      const hash = await client.getLatestCommit("empty-branch");
      expect(hash).toBeNull();
    });
  });

  describe("fetchBuildLog", () => {
    test("happy path: fetches log through 3 requests", async () => {
      let callNum = 0;
      mockFetch.mockImplementation((url: string) => {
        callNum++;
        if (url.includes("/rest/api/latest/result/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                stages: {
                  stage: [
                    {
                      results: {
                        result: [
                          { buildResultKey: "PLAN-JOB1-8", state: "Successful" },
                        ],
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/download/")) {
          return Promise.resolve(new Response("BUILD LOG CONTENT", { status: 200 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      const log = await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8");
      expect(log).toBe("BUILD LOG CONTENT");
    });

    test("no /browse/ returns null", async () => {
      const log = await client.fetchBuildLog("https://bamboo.test/something/PLAN-8");
      expect(log).toBeNull();
    });

    test("result fetch fails returns null", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 500 })),
      );
      const log = await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8");
      expect(log).toBeNull();
    });

    test("no jobs returns null", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ stages: { stage: [{ results: { result: [] } }] } }),
            { status: 200 },
          ),
        ),
      );
      const log = await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8");
      expect(log).toBeNull();
    });

    test("picks failed job over first", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/rest/api/latest/result/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                stages: {
                  stage: [
                    {
                      results: {
                        result: [
                          { buildResultKey: "PLAN-JOB1-8", state: "Successful" },
                          { buildResultKey: "PLAN-JOB2-8", state: "Failed" },
                        ],
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/download/")) {
          // The download URL should use the failed job key
          expect(url).toContain("PLAN-JOB2");
          return Promise.resolve(new Response("FAILED LOG", { status: 200 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      const log = await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8");
      expect(log).toBe("FAILED LOG");
    });

    test("log fetch fails returns null", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/rest/api/latest/result/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                stages: {
                  stage: [
                    {
                      results: {
                        result: [
                          { buildResultKey: "PLAN-JOB1-8", state: "Successful" },
                        ],
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/download/")) {
          return Promise.resolve(new Response("", { status: 404 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      const log = await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8");
      expect(log).toBeNull();
    });

    test("with bambooToken adds Authorization header", async () => {
      mockFetch.mockImplementation((url: string, opts?: any) => {
        if (url.includes("/rest/api/latest/result/")) {
          expect(opts.headers.Authorization).toBe("Bearer bamboo-tok");
          return Promise.resolve(
            new Response(
              JSON.stringify({
                stages: {
                  stage: [
                    {
                      results: {
                        result: [
                          { buildResultKey: "PLAN-JOB1-8", state: "Successful" },
                        ],
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/download/")) {
          expect(opts.headers.Authorization).toBe("Bearer bamboo-tok");
          return Promise.resolve(new Response("LOG", { status: 200 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      await client.fetchBuildLog("https://bamboo.test/browse/PLAN-8", "bamboo-tok");
    });
  });

  describe("findOpenPR", () => {
    test("500 returns null (non-auth non-ok)", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Server Error", { status: 500 })),
      );

      const pr = await client.findOpenPR("feature/TEST-1");
      expect(pr).toBeNull();
    });
  });

  describe("throwOnAuth", () => {
    test("empty body has empty detail", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("", { status: 401 })),
      );

      try {
        await client.findOpenPR("feature/X");
        expect.unreachable("should throw");
      } catch (e: any) {
        expect(e.status).toBe(401);
      }
    });
  });
});

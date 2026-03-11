import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTempRepo, writeWorkbenchJson, withTestEnv, captureOutput } from "../helpers";

// Mock readline before importing cmdLogin
mock.module("readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: Function) => cb(""),
    close: () => {},
  }),
}));

import { cmdLogin } from "../../lib/commands/login";

describe("login", () => {
  let env: Awaited<ReturnType<typeof createTempRepo>>;
  let origFetch: typeof globalThis.fetch;
  let origStdinOn: typeof process.stdin.on;
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origStdinOn = process.stdin.on.bind(process.stdin);
    origIsTTY = process.stdin.isTTY;
    (process.stdin as any).isTTY = false;
    // Mock stdin.on("data") to type characters then enter
    const origOn = process.stdin.on.bind(process.stdin);
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          // Type some chars, a backspace, then enter to cover all branches
          handler(Buffer.from("x"));
          handler(Buffer.from("\x7f")); // backspace
          handler(Buffer.from("\r"));   // enter
        }, 5);
        return process.stdin;
      }
      return origOn(event, handler);
    };
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    (process.stdin as any).on = origStdinOn;
    (process.stdin as any).isTTY = origIsTTY;
    env?.cleanup();
  });

  test("jira not configured shows skip message", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {}); // No jira/bb config

    const { stdout } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stdout).toContain("No Jira configured");
    expect(stdout).toContain("No Bitbucket configured");
  });

  test("jira configured + empty token + existing validates", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    // Pre-set existing auth
    writeFileSync(
      join(env.home, ".stanok", "auth.json"),
      JSON.stringify({ "http://jira.test": { token: "existing-token" } }),
    );

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/myself")) {
        return new Response(
          JSON.stringify({ name: "jdoe", displayName: "John Doe" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stdout).toContain("Authenticated as John Doe");
  });

  test("bitbucket configured section shows", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "bitbucket.url": "http://bb.test", "bitbucket.repo": "projects/X/repos/Y",
    });

    const { stdout } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stdout).toContain("Bitbucket");
  });

  test("bamboo configured section shows", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "bamboo.url": "http://bamboo.test",
    });

    const { stdout } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stdout).toContain("Bamboo");
  });

  test("jira token typed and validated", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    // Override stdin mock to type actual token chars
    const origOn2 = origStdinOn;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          for (const ch of "tok123") handler(Buffer.from(ch));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn2(event, handler);
    };

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/myself")) {
        return new Response(
          JSON.stringify({ name: "jdoe", displayName: "Jane Doe" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const { stdout } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stdout).toContain("Authenticated as Jane Doe");
  });

  test("jira auth fails shows error", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "jira.url": "http://jira.test", "jira.project": "TEST",
    });

    // Type a token
    const origOn2 = origStdinOn;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          for (const ch of "bad") handler(Buffer.from(ch));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn2(event, handler);
    };

    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as any;

    const { stderr } = await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    expect(stderr).toContain("Authentication failed");
  });

  test("bitbucket token saved", async () => {
    env = await createTempRepo();
    writeWorkbenchJson(env.repo, {
      "bitbucket.url": "http://bb.test", "bitbucket.repo": "projects/X/repos/Y",
    });

    // Type a token for BB
    const origOn2 = origStdinOn;
    (process.stdin as any).on = (event: string, handler: Function) => {
      if (event === "data") {
        setTimeout(() => {
          for (const ch of "bb-tok") handler(Buffer.from(ch));
          handler(Buffer.from("\r"));
        }, 5);
        return process.stdin;
      }
      return origOn2(event, handler);
    };

    await captureOutput(async () => {
      await withTestEnv(env, () => cmdLogin(env.repo));
    });

    const authData = JSON.parse(
      readFileSync(join(env.home, ".stanok", "auth.json"), "utf-8"),
    );
    expect(authData["http://bb.test"]?.token).toBe("bb-tok");
  });
});

import { describe, expect, test, mock } from "bun:test";
import { bitbucketPlugin } from "../index";
import type { AuthResolver } from "@stanok/core/plugin";
import type { CodeHost } from "@stanok/core/services";

const auth: AuthResolver = (url) => ({ token: "test-token" });
const noAuth: AuthResolver = () => null;

describe("BitbucketCodeHost via plugin provides", () => {
  const settings = {
    "bitbucket.url": "http://bb.test",
    "bitbucket.repo": "projects/UI/repos/app",
    "bamboo.url": "",
  };

  test("creates codeHost when url and repo present", () => {
    const codeHost = bitbucketPlugin.provides!.codeHost(settings, auth, null) as CodeHost;
    expect(codeHost).not.toBeNull();
    expect(codeHost.prUrl(42)).toContain("/pull-requests/42");
  });

  test("returns null when no url and no remoteUrl", () => {
    const result = bitbucketPlugin.provides!.codeHost({ ...settings, "bitbucket.url": "" }, auth, null);
    expect(result).toBeNull();
  });

  test("returns null when invalid repo format", () => {
    const result = bitbucketPlugin.provides!.codeHost({ ...settings, "bitbucket.repo": "invalid" }, auth, null);
    expect(result).toBeNull();
  });

  test("returns null when no auth", () => {
    const result = bitbucketPlugin.provides!.codeHost(settings, noAuth, null);
    expect(result).toBeNull();
  });

  test("createPRUrl generates correct URL", () => {
    const codeHost = bitbucketPlugin.provides!.codeHost(settings, auth, null) as CodeHost;
    const url = codeHost.createPRUrl("feature/X", "master");
    expect(url).toContain("sourceBranch");
    expect(url).toContain("targetBranch");
  });

  test("findOpenPR returns null when no PRs", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ values: [] }), { status: 200 });
    }) as any;

    const codeHost = bitbucketPlugin.provides!.codeHost(settings, auth, null) as CodeHost;
    const pr = await codeHost.findOpenPR("feature/X");
    expect(pr).toBeNull();

    globalThis.fetch = origFetch;
  });

  test("findOpenPR maps BitbucketPR to PullRequest", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({
        values: [{ id: 5, title: "Fix", state: "OPEN", links: { self: [{ href: "" }] } }],
      }), { status: 200 });
    }) as any;

    const codeHost = bitbucketPlugin.provides!.codeHost(settings, auth, null) as CodeHost;
    const pr = await codeHost.findOpenPR("feature/X");
    expect(pr).not.toBeNull();
    expect(pr!.id).toBe(5);
    expect(pr!.title).toBe("Fix");
    expect(pr!.state).toBe("OPEN");
    expect(pr!.url).toContain("/pull-requests/5");

    globalThis.fetch = origFetch;
  });

  test("auto-detects from remoteUrl when no settings", () => {
    const emptySettings = { "bitbucket.url": "", "bitbucket.repo": "", "bamboo.url": "" };
    const remoteUrl = "https://bb.example.com/context/scm/UI/app.git";
    const codeHost = bitbucketPlugin.provides!.codeHost(emptySettings, auth, remoteUrl) as CodeHost;
    expect(codeHost).not.toBeNull();
    expect(codeHost.prUrl(1)).toContain("/pull-requests/1");
  });

  test("auto-detect returns null for non-bitbucket remote", () => {
    const emptySettings = { "bitbucket.url": "", "bitbucket.repo": "", "bamboo.url": "" };
    const remoteUrl = "https://github.com/user/repo.git";
    const result = bitbucketPlugin.provides!.codeHost(emptySettings, auth, remoteUrl);
    expect(result).toBeNull();
  });

  test("explicit settings take precedence over remoteUrl", () => {
    const remoteUrl = "https://other-bb.com/scm/OTHER/other-repo.git";
    const codeHost = bitbucketPlugin.provides!.codeHost(settings, auth, remoteUrl) as CodeHost;
    expect(codeHost).not.toBeNull();
    // Should use settings URL (http://bb.test), not remoteUrl
    expect(codeHost.prUrl(1)).toContain("bb.test");
  });
});

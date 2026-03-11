// ─── Bitbucket Plugin ───────────────────────────────────────────────────────
// Provides `codeHost` service wrapping BitbucketClient + Bamboo build logs.

import { definePlugin, type AuthResolver } from "@stanok/core/plugin";
import type { PullRequest, CodeHost } from "@stanok/core/services";
import { BitbucketClient } from "@stanok/core/bitbucket";
import { parseBitbucketRepo } from "@stanok/core/project";

/**
 * Parse Bitbucket Server remote URL into base URL + repo slug.
 * Supports: https://{host}/{context}/scm/{project}/{repo}.git
 */
export function parseBitbucketRemote(remoteUrl: string): { url: string; project: string; repo: string } | null {
  const m = remoteUrl.match(/^(https?:\/\/.+?)\/scm\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return { url: m[1], project: m[2].toUpperCase(), repo: m[3] };
}

class BitbucketCodeHost implements CodeHost {
  constructor(
    private client: BitbucketClient,
    private bambooToken?: string,
  ) {}

  async findOpenPR(branch: string): Promise<PullRequest | null> {
    const pr = await this.client.findOpenPR(branch);
    if (!pr) return null;
    return {
      id: pr.id,
      title: pr.title,
      url: this.client.prOverviewUrl(pr.id),
      state: pr.state,
    };
  }

  async createPR(title: string, from: string, to: string): Promise<PullRequest> {
    const pr = await this.client.createPR(title, from, to);
    return {
      id: pr.id,
      title: pr.title,
      url: this.client.prOverviewUrl(pr.id),
      state: pr.state,
    };
  }

  createPRUrl(branch: string, target: string): string {
    return this.client.createPRUrl(branch, target);
  }

  prUrl(prId: string | number): string {
    return this.client.prOverviewUrl(Number(prId));
  }

  async getBuildStatuses(branch: string): Promise<{ state: string; name: string; url: string }[]> {
    const commitHash = await this.client.getLatestCommit(branch);
    if (!commitHash) return [];
    const statuses = await this.client.getBuildStatuses(commitHash);
    return statuses.map((s) => ({ state: s.state, name: s.name, url: s.url }));
  }

  async fetchBuildLog(buildUrl: string): Promise<string | null> {
    return this.client.fetchBuildLog(buildUrl, this.bambooToken);
  }
}

export const bitbucketPlugin = definePlugin({
  name: "bitbucket",
  settings: {
    "bitbucket.url": "",
    "bitbucket.repo": "",
    "bamboo.url": "",
  },
  provides: {
    codeHost(settings, auth, remoteUrl) {
      let url = settings["bitbucket.url"];
      let repoSlug = settings["bitbucket.repo"];

      // Auto-detect from git remote if not configured
      if (!url && remoteUrl) {
        const detected = parseBitbucketRemote(remoteUrl);
        if (detected) {
          url = detected.url;
          repoSlug = `projects/${detected.project}/repos/${detected.repo}`;
        }
      }

      if (!url || !repoSlug) return null;
      const parsed = parseBitbucketRepo(repoSlug);
      if (!parsed) return null;
      const a = auth(url);
      if (!a) return null;
      const bambooUrl = settings["bamboo.url"];
      const bambooAuth = bambooUrl ? auth(bambooUrl) : null;
      return new BitbucketCodeHost(
        new BitbucketClient(url, parsed.project, parsed.repo, a.token),
        bambooAuth?.token,
      );
    },
  },
});

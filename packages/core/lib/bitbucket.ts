// ─── Bitbucket Server REST Client ───────────────────────────────────────────

export interface BuildStatus {
  state: string;
  key: string;
  name: string;
  url: string;
  description?: string;
}

export interface BitbucketPR {
  id: number;
  title: string;
  state: string;
  links: { self: { href: string }[] };
}

export class BitbucketClient {
  private baseUrl: string;
  private project: string;
  private repo: string;
  private token: string;

  constructor(
    baseUrl: string,
    project: string,
    repo: string,
    token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.project = project;
    this.repo = repo;
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async throwOnAuth(res: Response): Promise<void> {
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      const detail = body ? `: ${body.slice(0, 200)}` : "";
      const err: any = new Error(`${res.status}${detail}`);
      err.status = res.status;
      throw err;
    }
  }

  private apiBase(): string {
    return `${this.baseUrl}/rest/api/1.0/projects/${this.project}/repos/${this.repo}`;
  }

  repoUrl(): string {
    return `${this.baseUrl}/projects/${this.project}/repos/${this.repo}`;
  }

  async findOpenPR(branch: string): Promise<BitbucketPR | null> {
    const url = `${this.apiBase()}/pull-requests?state=OPEN&at=refs/heads/${branch}&direction=OUTGOING`;
    const res = await fetch(url, { headers: this.headers() });
    await this.throwOnAuth(res);
    if (!res.ok) return null;
    const data = await res.json() as { values: BitbucketPR[] };
    return data.values?.[0] ?? null;
  }

  async createPR(
    title: string,
    fromBranch: string,
    toBranch: string = "master",
    description: string = "",
  ): Promise<BitbucketPR> {
    const url = `${this.apiBase()}/pull-requests`;
    const body = {
      title,
      description,
      fromRef: { id: `refs/heads/${fromBranch}` },
      toRef: { id: `refs/heads/${toBranch}` },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      const err: any = new Error(`Bitbucket create PR → ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json() as Promise<BitbucketPR>;
  }

  createPRUrl(branch: string, targetBranch: string = "master"): string {
    return `${this.repoUrl()}/pull-requests?create&sourceBranch=refs/heads/${branch}&targetBranch=refs/heads/${targetBranch}`;
  }

  prOverviewUrl(prId: number): string {
    return `${this.repoUrl()}/pull-requests/${prId}/overview`;
  }

  async getLatestCommit(branch: string): Promise<string | null> {
    const url = `${this.apiBase()}/commits?until=refs/heads/${branch}&limit=1`;
    const res = await fetch(url, { headers: this.headers() });
    await this.throwOnAuth(res);
    if (!res.ok) return null;
    const data = (await res.json()) as { values: { id: string }[] };
    return data.values?.[0]?.id ?? null;
  }

  async getBuildStatuses(commitHash: string): Promise<BuildStatus[]> {
    const url = `${this.baseUrl}/rest/build-status/1.0/commits/${commitHash}`;
    const res = await fetch(url, { headers: this.headers() });
    await this.throwOnAuth(res);
    if (!res.ok) return [];
    const data = (await res.json()) as { values: BuildStatus[] };
    return data.values ?? [];
  }

  async fetchBuildLog(buildUrl: string, bambooToken?: string): Promise<string | null> {
    // buildUrl: https://host/bamboo/browse/FRONTENDCI-GENERALMP3PR1015-8 (plan-level)
    // Log lives at job-level: need to resolve via REST API
    const browseIdx = buildUrl.indexOf("/browse/");
    if (browseIdx === -1) return null;
    const bambooBase = buildUrl.slice(0, browseIdx);
    const buildKey = buildUrl.slice(browseIdx + "/browse/".length);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (bambooToken) headers.Authorization = `Bearer ${bambooToken}`;

    // Get job keys from build result
    const resultUrl = `${bambooBase}/rest/api/latest/result/${buildKey}?expand=stages.stage.results.result`;
    const resultRes = await fetch(resultUrl, { headers });
    if (!resultRes.ok) return null;
    const result = (await resultRes.json()) as any;

    // Find first failed job, or first job
    const jobs: { buildResultKey: string; state: string }[] = [];
    for (const stage of result.stages?.stage ?? []) {
      for (const r of stage.results?.result ?? []) {
        jobs.push(r);
      }
    }
    if (!jobs.length) return null;
    const job = jobs.find((j) => j.state === "Failed") || jobs[0];

    // Job key: FRONTENDCI-GENERALMP3PR1015-JOB1-8
    const jobKey = job.buildResultKey;
    const lastDash = jobKey.lastIndexOf("-");
    const jobPlanKey = jobKey.slice(0, lastDash);
    const buildNumber = jobKey.slice(lastDash + 1);

    const logUrl = `${bambooBase}/download/${jobPlanKey}/build_logs/${jobKey}.log`;
    const logHeaders: Record<string, string> = { Accept: "text/plain" };
    if (bambooToken) logHeaders.Authorization = `Bearer ${bambooToken}`;
    const logRes = await fetch(logUrl, { headers: logHeaders });
    if (!logRes.ok) return null;
    return logRes.text();
  }
}

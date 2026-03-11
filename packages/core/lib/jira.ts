// ─── Jira REST Client (Server / Data Center) ───────────────────────────────

export interface JiraIssue {
  key: string;
  fields: Record<string, any>;
}

export class JiraClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async _fetch(label: string, basePath: string, method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${basePath}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      const err: any = new Error(`${label} ${method} ${path} → ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private request(method: string, path: string, body?: any): Promise<any> {
    return this._fetch("Jira", "/rest/api/2", method, path, body);
  }

  // ─── Issue operations ───────────────────────────────────────────────────

  async getIssue(key: string): Promise<JiraIssue> {
    return this.request("GET", `/issue/${key}`);
  }

  async search(jql: string, fields: string[] = ["summary"], maxResults = 50): Promise<{ issues: JiraIssue[] }> {
    return this.request("GET", `/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(",")}&maxResults=${maxResults}`);
  }

  async updateFields(key: string, fields: Record<string, any>): Promise<void> {
    await this.request("PUT", `/issue/${key}`, { fields });
  }

  async assign(key: string, username: string): Promise<void> {
    await this.request("PUT", `/issue/${key}/assignee`, { name: username });
  }

  async addLabel(key: string, label: string): Promise<void> {
    await this.request("PUT", `/issue/${key}`, {
      update: { labels: [{ add: label }] },
    });
  }

  // ─── Worklog ────────────────────────────────────────────────────────────

  async addWorklog(
    key: string,
    timeSpent: string,
    comment?: string,
  ): Promise<void> {
    const body: any = { timeSpent };
    if (comment) body.comment = comment;
    await this.request("POST", `/issue/${key}/worklog`, body);
  }

  // ─── Create issue ──────────────────────────────────────────────────────

  async createIssue(input: {
    projectKey: string;
    summary: string;
    description: string;
    issueType?: string;
    priority?: string;
    labels?: string[];
    assignee?: string;
    components?: { id: string }[];
    customFields?: Record<string, any>;
  }): Promise<{ key: string; id: string }> {
    const fields: Record<string, any> = {
      project: { key: input.projectKey },
      summary: input.summary,
      description: input.description,
      issuetype: { name: input.issueType ?? "Bug" },
    };
    if (input.priority) fields.priority = { name: input.priority };
    if (input.labels?.length) fields.labels = input.labels;
    if (input.assignee) fields.assignee = { name: input.assignee };
    if (input.components?.length) fields.components = input.components;
    if (input.customFields) Object.assign(fields, input.customFields);

    const data = await this.request("POST", "/issue", { fields });
    return { key: data.key, id: data.id };
  }

  // ─── Board / Filter ────────────────────────────────────────────────────

  async getBoardFilterJql(boardId: string): Promise<string> {
    const config = await this._fetch("Jira Agile", "/rest/agile/1.0", "GET", `/board/${boardId}/configuration`);
    const filterId = config.filter?.id;
    if (!filterId) throw new Error(`Board ${boardId} has no filter`);
    const filter = await this.request("GET", `/filter/${filterId}`);
    return filter.jql;
  }

  async getQuickFilterJql(boardId: string, quickFilterId: string): Promise<string | null> {
    const data = await this._fetch("GreenHopper", "/rest/greenhopper/1.0", "GET", `/rapidviewconfig/editmodel.json?rapidViewId=${boardId}`);
    const filters: any[] = data?.rapidListConfig?.quickFilters ?? [];
    const qf = filters.find((f: any) => String(f.id) === quickFilterId);
    return qf?.query ?? null;
  }

  // ─── User ───────────────────────────────────────────────────────────────

  async myself(): Promise<{ name: string; displayName: string }> {
    return this.request("GET", "/myself");
  }
}

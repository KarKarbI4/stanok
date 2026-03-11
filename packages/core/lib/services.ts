// ─── Service interfaces ─────────────────────────────────────────────────────
// Abstract capabilities that plugins can provide. Commands consume these
// interfaces — they don't know about Jira, Bitbucket, or any specific provider.

export interface Issue {
  key: string;
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee?: string;
  description?: string;
  fields: Record<string, any>;
}

export interface IssueTracker {
  getIssue(key: string): Promise<Issue>;
  search(query: string, maxResults?: number): Promise<Issue[]>;
  myself(): Promise<{ name: string; displayName: string }>;
  issueUrl(key: string): string;
  addWorklog?(key: string, time: string, comment?: string): Promise<void>;
  myIssues?(): Promise<Issue[]>;
  batchGet?(keys: string[]): Promise<Issue[]>;
}

export interface PullRequest {
  id: string | number;
  title: string;
  url: string;
  state: string;
}

export interface CodeHost {
  findOpenPR(branch: string): Promise<PullRequest | null>;
  createPR(title: string, from: string, to: string): Promise<PullRequest>;
  createPRUrl(branch: string, target: string): string;
  prUrl(prId: string | number): string;
  getBuildStatuses?(branch: string): Promise<{ state: string; name: string; url: string }[]>;
  fetchBuildLog?(buildUrl: string): Promise<string | null>;
}

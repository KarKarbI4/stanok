---
name: stanok
description: Use Stanok CLI to manage parallel git worktree-based development environments. Covers CLI usage (sk start, sk stop, sk ls, sk pr, etc.), installing and configuring plugins, and creating custom plugins with the definePlugin API. Use when the user asks about stanok, worktree management, stanok plugins, or wants to extend stanok functionality.
metadata:
  author: stanok
  version: "1.0.0"
---

# Stanok CLI

Stanok (`sk`) is a CLI for managing parallel git worktree-based development environments. One `sk start TASK-123` creates a git worktree, installs deps, and opens your IDE. One `sk stop TASK-123 --remove` cleans it up.

## When to Use This Skill

Use when the user:

- Asks about managing git worktrees for parallel development
- Wants to start, stop, list, or manage development environments
- Needs to configure stanok for a repository
- Wants to install, configure, or create stanok plugins
- Asks about `sk` or `stanok` commands
- Needs help with stanok project configuration (`.stanok/settings.json`)

## CLI Usage

### Initial Setup

```bash
# Install globally
bun install -g stanok

# Register a repo
cd ~/projects/my-app
sk init

# Configure auth tokens (Jira, Bitbucket, Bamboo)
sk login
```

### Core Workflow

```bash
# Start working on a task (creates worktree, opens IDE, runs hooks)
sk start TASK-123

# Start with env vars
sk start TASK-123 --env STAND=dev --env DEBUG=true

# Commit with auto task ID prefix (from current branch)
sk c "fix header alignment"
# → TASK-123 | fix header alignment

# Set/show env vars in worktree
sk env KEY=VALUE

# List active worktrees
sk ls

# Stop worktree
sk stop TASK-123

# Stop and remove worktree
sk stop TASK-123 --remove
```

### Git / Worktree Commands

```bash
# Remove merged/orphaned/stale worktrees
sk prune
sk prune --dry-run

# Rename task (branch + worktree)
sk mv OLD-ID NEW-ID

# Re-sync copyFiles to worktree
sk copy TASK-123

# Run command in worktree context
sk run TASK-123 npm test

# Open or create Pull Request
sk pr
sk pr --build    # show build status

# Open worktree in Finder or terminal
sk open TASK-123
sk open TASK-123 --terminal

# Show diff from base branch
sk diff TASK-123
sk diff TASK-123 --stat
```

### Admin Commands

```bash
# Show resolved configuration
sk config

# Regenerate settings schema after editing plugins.ts
sk reload

# Open auth.json in editor
sk auth

# Check environment and configuration
sk doctor

# Shell completions
eval "$(sk completions zsh)"    # add to ~/.zshrc
eval "$(sk completions bash)"   # add to ~/.bashrc
sk completions fish | source    # fish
```

### Plugin-Provided Commands

These require the corresponding plugin in `~/.stanok/plugins.ts`:

```bash
# Jira plugin
sk issue TASK-123 --text      # show issue info
sk issue TASK-123             # open in browser
sk issue --my                 # list my issues
sk issues                     # my issues from active sprint
sk issues --format=json       # JSON output

# Portless plugin
sk port TASK-123              # show dev server port
```

## How `sk start` Works

1. Creates git worktree at `../<repo>__worktrees/<task-id>` from `origin/<baseBranch>`
2. Detects or creates branch using `branchTemplate` (default: `{task}` -> `TASK-123`)
3. Copies shared files specified in `copyFiles.include`
4. Writes env vars to `.env.development.local` (or custom `envFile`)
5. Runs `postCreate` plugin hooks (only for new worktrees)
6. Runs `preStart` plugin hooks (open IDE, split terminal, etc.)

### Conventions

- Task ID `PROJ-123` -> branch `feature/PROJ-123` (with `branchTemplate: "feature/{task}"`)
- Worktree path: `../<repo>__worktrees/proj-123` (lowercase)
- Task IDs are stored uppercase, worktree dirs lowercase

## Installing Plugins

All functionality beyond core worktree management is provided by plugins. Six official plugins are included in the `stanok` package. They are loaded from `~/.stanok/plugins.ts`.

### Step 1: Create plugins.ts

Create `~/.stanok/plugins.ts`:

```ts
import { definePlugins } from "stanok/plugin";

import { jiraPlugin } from "stanok/plugin-jira";
import { bitbucketPlugin } from "stanok/plugin-bitbucket";
import { ide } from "stanok/plugin-ide";

export const plugins = definePlugins([
  jiraPlugin,
  bitbucketPlugin,
  ide,
]);
```

### Step 3: Reload

```bash
sk reload
```

This regenerates the command cache at `~/.stanok/commands.json`.

### Available Plugins

| Package | Purpose | Settings |
|---------|---------|----------|
| `stanok/plugin-jira` | Jira issue tracker, `sk issue` / `sk issues` commands, task enrichment | `jira.url`, `jira.project`, `jira.exploreIssues` |
| `stanok/plugin-bitbucket` | Bitbucket PRs, build statuses, Bamboo logs | `bitbucket.url`, `bitbucket.repo`, `bamboo.url` |
| `stanok/plugin-ide` | Opens IDE on `sk start` | `ide.binary`, `ide.args` |
| `stanok/plugin-claude` | Symlinks Claude Code project memory to worktrees | (none) |
| `stanok/plugin-agent-cli` | Splits iTerm/tmux pane for agent CLI | `agent-cli.terminal`, `agent-cli.binary`, `agent-cli.args` |
| `stanok/plugin-portless` | Portless dev server, `sk port` command | (none) |

### Configuring Plugin Settings

Plugin settings use dot-separated keys. They resolve in order: **plugin defaults < .stanok/settings.json < .stanok/settings.local.json < ~/.stanok/settings.json**.

In `.stanok/settings.json` (per-project, committed):

```json
{
  "jira.url": "https://jira.example.com",
  "jira.project": "PROJ",
  "bitbucket.url": "https://bitbucket.example.com",
  "bitbucket.repo": "projects/PROJ/repos/my-repo",
  "ide.binary": "cursor"
}
```

In `~/.stanok/settings.json` (global, personal):

```json
{
  "ide.binary": "webstorm",
  "agent-cli.terminal": "iterm"
}
```

In `.stanok/settings.local.json` (per-project, gitignored):

```json
{
  "ide.binary": "webstorm"
}
```

## Repository Configuration

### .stanok/settings.json

```json
{
  "baseBranch": "master",
  "branchTemplate": "feature/{task}",
  "envFile": ".env.development.local",
  "mergeDetection": "Pull request",
  "proxyPort": 1355,
  "pruneIgnore": ["*.log"],
  "jira.url": "https://jira.example.com",
  "jira.project": "PROJ"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `baseBranch` | `"master"` | Branch to create worktrees from |
| `branchTemplate` | `"{task}"` | Branch name pattern (`{task}` is replaced with task ID) |
| `envFile` | `".env.development.local"` | File for worktree env vars |
| `mergeDetection` | `"Pull request"` | Grep pattern to detect merged branches in `sk prune` |
| `proxyPort` | `1355` | Base port for dev server proxy |
| `pruneIgnore` | — | Glob patterns to exclude from prune |

## Creating Custom Plugins

Use `definePlugin()` from `stanok/plugin`.

### Minimal Plugin

```ts
import { definePlugin } from "stanok/plugin";

export const myPlugin = definePlugin({
  name: "my-plugin",
  settings: {},
});
```

### Full Plugin Structure

```ts
import { definePlugin } from "stanok/plugin";
import type { PluginContext, AuthResolver } from "stanok/plugin";

interface MySettings {
  "my-plugin.url": string;
  "my-plugin.enabled": boolean;
}

export const myPlugin = definePlugin<MySettings>({
  name: "my-plugin",

  // Default settings (overridable in .stanok/settings.json / ~/.stanok/settings.json)
  settings: {
    "my-plugin.url": "",
    "my-plugin.enabled": true,
  },

  // Patterns to exclude from `sk prune`
  pruneIgnore: [".my-plugin-cache/**"],

  // ── Services ──
  // Provide named services that core commands consume.
  // Return null if the plugin can't activate (missing config/auth).
  provides: {
    issueTracker(settings, auth, remoteUrl) {
      if (!settings["my-plugin.url"]) return null;
      const a = auth(settings["my-plugin.url"]);
      if (!a) return null;
      return {
        async getIssue(key) { /* ... */ },
        async search(query, maxResults) { /* ... */ },
        async myself() { /* ... */ },
        issueUrl(key) { return `${settings["my-plugin.url"]}/issue/${key}`; },
      };
    },
  },

  // ── CLI Commands ──
  // Register custom `sk <name>` commands.
  // Return null if the command can't activate.
  commands: {
    "my-cmd"(settings, auth) {
      if (!settings["my-plugin.enabled"]) return null;
      return {
        desc: "Do something useful",
        usage: "<ARG> [--flag]",
        async run(args, cwd) {
          // args: string[] — positional args and flags
          // cwd: string | undefined — working directory
          console.log("Running my-cmd with", args);
        },
      };
    },
  },

  // ── Lifecycle Hooks ──
  // Called during worktree lifecycle. ctx contains:
  //   taskId, branch, env, repo, wtPath
  async postCreate(ctx, settings) {
    // After worktree created (first time only)
    console.log(`Created worktree for ${ctx.taskId} at ${ctx.wtPath}`);
  },
  async preStart(ctx, settings) {
    // Before IDE/tools open (every sk start)
  },
  async preStop(ctx, settings) {
    // Before worktree stopped
  },
  async postRemove(ctx, settings) {
    // After worktree removed
  },

  // ── Task Enrichment ──
  // Mutate tasks in-place to add extra data for `sk ls --format=json`
  async enrich(tasks, settings, auth) {
    for (const task of tasks) {
      task.summary = "Enriched summary";
      task.status = "In Progress";
    }
  },

  // ── Status Colors ──
  // Map issue statuses to semantic groups for colored output
  statusColors(settings) {
    return {
      open: ["To Do", "Open", "Backlog"],
      inProgress: ["In Progress", "In Review"],
      done: ["Done", "Closed", "Resolved"],
    };
  },
});
```

### PluginContext (lifecycle hooks)

```ts
interface PluginContext {
  taskId: string;                    // e.g. "PROJ-123"
  branch: string;                    // e.g. "feature/PROJ-123"
  env: Record<string, string>;       // worktree env vars
  repo: string;                      // main repo path
  wtPath: string;                    // worktree path
}
```

### Service Interfaces

Plugins can provide two core services:

**`issueTracker`** (IssueTracker):

```ts
interface IssueTracker {
  getIssue(key: string): Promise<Issue>;
  search(query: string, maxResults?: number): Promise<Issue[]>;
  myself(): Promise<{ name: string; displayName: string }>;
  issueUrl(key: string): string;
  addWorklog?(key: string, time: string, comment?: string): Promise<void>;
  myIssues?(): Promise<Issue[]>;
  batchGet?(keys: string[]): Promise<Issue[]>;
}
```

**`codeHost`** (CodeHost):

```ts
interface CodeHost {
  findOpenPR(branch: string): Promise<PullRequest | null>;
  createPR(title: string, from: string, to: string): Promise<PullRequest>;
  createPRUrl(branch: string, target: string): string;
  prUrl(prId: string | number): string;
  getBuildStatuses?(branch: string): Promise<{ state: string; name: string; url: string }[]>;
  fetchBuildLog?(buildUrl: string): Promise<string | null>;
}
```

### Registering a Custom Plugin

Publish your plugin as an npm package, then install and register it:

```bash
cd ~/.stanok
bun add my-stanok-plugin
```

Add it to `~/.stanok/plugins.ts`:

```ts
import { definePlugins } from "stanok/plugin";
import { jiraPlugin } from "stanok/plugin-jira";
import { myPlugin } from "my-stanok-plugin";

export const plugins = definePlugins([
  jiraPlugin,
  myPlugin,
]);
```

Then run `sk reload` to regenerate the command cache.

For local development, you can also import from a relative path:

```ts
import { myPlugin } from "./my-plugin";
```

### Plugin Settings Resolution

Settings are resolved in priority order (last wins):

1. **Plugin defaults** — `settings` field in `definePlugin()`
2. **Project config** — `.stanok/settings.json` (committed to repo)
3. **Personal project config** — `.stanok/settings.local.json` (gitignored)
4. **Global config** — `~/.stanok/settings.json`

All settings use dot-separated keys (e.g. `"jira.url"`, `"my-plugin.enabled"`).

### Auth in Plugins

The `auth` parameter is a resolver function:

```ts
const a = auth("https://my-service.example.com");
// Returns { token: string } or null
```

Auth tokens are stored in `~/.stanok/auth.json` and configured via `sk login`. The resolver matches by URL prefix.

## File Structure Reference

```
~/.stanok/
  package.json         # Plugin dependencies
  node_modules/        # Installed plugins
  plugins.ts           # Plugin registry
  settings.json        # Global settings (dot-separated keys)
  auth.json            # API tokens (managed by sk login)
  state.json           # Registered repos, env vars (auto-managed)
  commands.json        # Plugin command cache (auto-generated)

<repo>/
  .stanok/
    settings.json        # Project config (committed)
    settings.local.json  # Personal overrides (gitignored)

<repo>__worktrees/
  <task-id>/           # Worktree directory (lowercase)
```

# stanok

> CLI for managing parallel git worktree-based development environments

[![npm](https://img.shields.io/npm/v/stanok)](https://www.npmjs.com/package/stanok)
[![CI](https://github.com/KarKarbI4/stanok/actions/workflows/ci.yml/badge.svg)](https://github.com/KarKarbI4/stanok/actions/workflows/ci.yml)
[![tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/KarKarbI4/cf2b3c9663b43986fc6f989989b835a9/raw/stanok-tests.json)](https://github.com/KarKarbI4/stanok/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/stanok)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun%20%3E%3D%201.2-f472b6)](https://bun.sh)

One `sk start TASK-123` creates a git worktree, installs deps, transitions Jira to "In Progress", and opens your IDE. One `sk done TASK-123` pushes, creates a PR, and transitions to "In Review".

## Installation

```bash
bun install -g stanok
```

Requirements:

- **Bun** >= 1.2
- **git** >= 2.15 (worktree support)

Some plugins (`plugin-agent-cli`, `plugin-ide`) use iTerm/AppleScript on macOS. Core CLI and worktree management work on any OS.

After installation, the CLI is available as `stanok` or shorthand `sk`.

## Quickstart

```bash
# 1. Register current repo
cd ~/projects/my-app
sk init

# 2. Configure auth tokens (Jira, Bitbucket)
sk login

# 3. Start working on a task
sk start TASK-123

# 4. Commit (auto-prefixes with task ID)
sk c "fix header alignment"
# → TASK-123 | fix header alignment

# 5. List active worktrees
sk ls

# 6. Remove worktree when done
sk stop TASK-123 --remove
```

`sk start` creates a git worktree at `../<repo>__worktrees/task-123`, checks out branch `feature/TASK-123` (from `origin/master`), copies shared files, writes env vars, and runs plugin hooks (open IDE, split terminal, etc.).

### Commands

#### Workflow

| Command                                | Description                       |
| -------------------------------------- | --------------------------------- |
| `sk start <TASK_ID> [--env KEY=VALUE]` | Create worktree and start working |
| `sk c <message>`                       | Commit with task ID prefix        |
| `sk env [KEY=VALUE ...]`               | Set/show env vars in worktree     |
| `sk ls`                                | List worktrees                    |

#### Git / Worktree

| Command                         | Description                        |
| ------------------------------- | ---------------------------------- |
| `sk stop <TASK_ID> [--remove]`  | Stop worktree, optionally remove   |
| `sk prune [--dry-run]`          | Remove merged/orphaned worktrees   |
| `sk mv <OLD_ID> <NEW_ID>`       | Rename task (branch + worktree)    |
| `sk copy [TASK_ID]`             | Re-sync copyFiles to worktree      |
| `sk run <TASK_ID> <command...>` | Run command in worktree context    |
| `sk pr [--build]`               | Open PR or show build status       |
| `sk open [TASK_ID] [--terminal]`| Open worktree in Finder / terminal |
| `sk diff [TASK_ID] [--stat]`    | Show diff from base branch         |

#### Admin

| Command                            | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `sk login`                         | Configure Jira + Bitbucket + Bamboo auth |
| `sk init`                          | Register cwd as stanok repo              |
| `sk config`                        | Show resolved configuration              |
| `sk reload`                        | Regenerate settings schema               |
| `sk auth`                          | Open auth.json in default editor         |
| `sk doctor`                        | Check environment and configuration      |
| `sk completions <zsh\|bash\|fish>` | Generate shell completions               |

Plugins can add extra commands (e.g. `sk issue`, `sk issues`, `sk port`).

### Shell completions

```bash
# zsh — add to ~/.zshrc
eval "$(sk completions zsh)"

# bash — add to ~/.bashrc
eval "$(sk completions bash)"

# fish
sk completions fish | source
```

## Raycast extension

Stanok includes a Raycast extension for starting worktrees from the launcher.

### Setup

```bash
cd packages/raycast
bun install
bun run dev    # opens in Raycast dev mode
```

The extension provides a **Start Worktree** command — search for a Jira task and start (or reopen) a worktree without touching the terminal.

To install permanently, run `bun run build` and import the extension in Raycast settings.

## Plugins

All functionality beyond the core worktree management is provided by plugins. Six official plugins are included in the `stanok` package. They are loaded from `~/.stanok/plugins.ts`.

### Configuring plugins

Create `~/.stanok/plugins.ts` to select which plugins to load:

```ts
import { definePlugins } from "stanok/plugin";

import { jiraPlugin } from "stanok/plugin-jira";
import { bitbucketPlugin } from "stanok/plugin-bitbucket";
import { ide } from "stanok/plugin-ide";

export default definePlugins([
  jiraPlugin,
  bitbucketPlugin,
  ide,
]);
```

After editing, run `sk reload` to regenerate the command cache.

### Built-in plugins

| Subpath                  | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `stanok/plugin-jira`      | Jira issue tracker: `sk issue`, `sk issues`, task enrichment, status colors |
| `stanok/plugin-bitbucket` | Bitbucket code host: PR creation, build statuses, Bamboo log fetching       |
| `stanok/plugin-ide`       | Opens IDE on `sk start` (detects from `$EDITOR`)                            |
| `stanok/plugin-claude`    | Symlinks Claude Code project memory to worktrees                            |
| `stanok/plugin-agent-cli` | Splits iTerm/tmux pane for agent CLI on `sk start`                          |
| `stanok/plugin-portless`  | Portless dev server integration, `sk port` command                          |

### Writing a plugin

```ts
import { definePlugin } from "stanok/plugin";

export const myPlugin = definePlugin({
  name: "my-plugin",

  // Default settings (overridable in .stanok/settings.json / ~/.stanok/settings.json)
  settings: {
    "my-plugin.enabled": true,
  },

  // Provide services (issueTracker, codeHost, etc.)
  provides: {
    myService(settings, auth, remoteUrl) {
      return {
        /* implement a service interface */
      };
    },
  },

  // Add CLI commands
  commands: {
    "my-cmd"(settings, auth) {
      return {
        desc: "Do something",
        usage: "[args]",
        async run(args, cwd) {
          /* ... */
        },
      };
    },
  },

  // Lifecycle hooks
  async postCreate(ctx, settings) {
    /* after worktree created */
  },
  async preStart(ctx, settings) {
    /* before IDE/tools open */
  },
  async preStop(ctx, settings) {
    /* before worktree stopped */
  },
  async postRemove(ctx, settings) {
    /* after worktree removed */
  },

  // Enrich task list with extra data
  async enrich(tasks, settings, auth) {
    /* mutate tasks in-place */
  },

  // Status color mapping
  statusColors(settings) {
    return { open: ["To Do"], inProgress: ["In Progress"], done: ["Done"] };
  },
});
```

#### Service interfaces

Plugins can provide two core services that built-in commands consume:

**`issueTracker`** (IssueTracker) — `getIssue`, `search`, `myself`, `issueUrl`, `myIssues`, `batchGet`, `addWorklog`

**`codeHost`** (CodeHost) — `findOpenPR`, `createPR`, `createPRUrl`, `prUrl`, `getBuildStatuses`, `fetchBuildLog`

## User-level configuration

User config lives in `~/.stanok/`:

| File            | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `settings.json` | Global settings (shared across all repos)              |
| `auth.json`     | API tokens for Jira, Bitbucket, Bamboo                 |
| `plugins.ts`    | Plugin registry                                        |
| `state.json`    | Registered repos, per-repo env vars (auto-managed)     |
| `commands.json` | Cached plugin commands (auto-generated by `sk reload`) |

### settings.json

Global defaults using dot-separated keys. These apply to all repos unless overridden at the project level:

```json
{
  "ide.binary": "cursor",
  "ide.args": ["--new-window"],
  "agent-cli.terminal": "iterm",
  "agent-cli.binary": "claude"
}
```

### auth.json

Created by `sk login`. Stores API tokens:

```json
{
  "jira": { "url": "https://jira.example.com", "token": "..." },
  "bitbucket": { "url": "https://bitbucket.example.com", "token": "..." },
  "bamboo": { "url": "https://bamboo.example.com", "token": "..." }
}
```

You can also edit directly with `sk auth`.

## Repository-level configuration

`sk init` creates a `.stanok/` directory in the repo root with project settings. It also adds `.stanok/*.local*` to `.gitignore`.

### .stanok/settings.json (committed)

```json
{
  "baseBranch": "master",
  "branchTemplate": "feature/{task}",
  "envFile": ".env.development.local",
  "mergeDetection": "Pull request",
  "pruneIgnore": ["*.log"],
  "jira.url": "https://jira.example.com",
  "jira.project": "PROJ",
  "bitbucket.url": "https://bitbucket.example.com",
  "bitbucket.repo": "projects/PROJ/repos/my-repo"
}
```

| Field            | Default                    | Description                                          |
| ---------------- | -------------------------- | ---------------------------------------------------- |
| `baseBranch`     | `"master"`                 | Branch to create worktrees from                      |
| `branchTemplate` | `"{task}"`                 | Branch name pattern (`{task}` replaced with task ID) |
| `envFile`        | `".env.development.local"` | File for worktree env vars                           |
| `mergeDetection` | `"Pull request"`           | Grep pattern to detect merged branches               |
| `proxyPort`      | `1355`                     | Base port for dev server proxy                       |
| `pruneIgnore`    | —                          | Glob patterns to exclude from prune                  |
| `sentry`         | —                          | Sentry environments config                           |

Plugin settings use dot-separated keys in the same file (`jira.url`, `bitbucket.repo`, `ide.binary`, etc.).

### .stanok/settings.local.json (gitignored)

Same format, values override the committed config. Use for personal preferences that shouldn't be shared with the team:

```json
{
  "ide.binary": "webstorm",
  "agent-cli.terminal": "tmux"
}
```

## Releasing

Stanok uses [changesets](https://github.com/changesets/changesets) for versioning and publishing.

### After making changes

```bash
# 1. Create a changeset describing your changes
bun run changeset
# Select affected packages, bump type (patch/minor/major), and write a summary
```

This creates a file in `.changeset/` — commit it with your code.

### Publishing a release

```bash
# 2. Bump versions and generate CHANGELOGs
bun run version
# Review the changes, then commit

# 3. Build and publish to npm
bun run release
```

`bun run version` reads all pending changesets, bumps `package.json` versions (including dependents), writes `CHANGELOG.md` per package, and removes the changeset files.

`bun run release` runs `clean → build → changeset publish`, which publishes every package whose version isn't on npm yet.

### Bump types

| Type    | When                                       | Example        |
| ------- | ------------------------------------------ | -------------- |
| `patch` | Bug fixes, docs                            | 0.1.0 → 0.1.1 |
| `minor` | New features, non-breaking changes         | 0.1.0 → 0.2.0 |
| `major` | Breaking changes (API, config, CLI output) | 0.2.0 → 1.0.0 |

Since stanok is now a single package, `bun run version` bumps the one version and generates the changelog.

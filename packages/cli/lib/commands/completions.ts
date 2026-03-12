import { WbError } from "@stanok/core/utils";
import { COMMANDS, TASK_ID_CMDS, readCommandsCache } from "../commands";

function zshScript(): string {
  const groups = Object.entries(COMMANDS).map(([group, cmds]) => {
    const items = Object.entries(cmds).map(([k, v]) => `    '${k}:${v.desc}'`).join("\n");
    return `  ${group}=(\n${items}\n  )`;
  }).join("\n\n");

  // Plugin commands from cache
  const cached = readCommandsCache();
  const cachedEntries = Object.entries(cached);
  let extGroup = "";
  if (cachedEntries.length) {
    const items = cachedEntries.map(([k, v]) => `    '${k}:${v.desc}'`).join("\n");
    extGroup = `\n\n  extensions=(\n${items}\n  )`;
  }

  const taskCmds = [...TASK_ID_CMDS];
  // Add plugin commands that take task IDs (have usage containing TASK_ID)
  for (const [name, cmd] of cachedEntries) {
    if (cmd.usage && /TASK_ID/i.test(cmd.usage)) taskCmds.push(name);
  }

  const describeExt = cachedEntries.length ? `\n    _describe -t extensions -V 'extensions' extensions` : "";

  return `_stanok() {
  local -a workflow git admin${cachedEntries.length ? " extensions" : ""}

${groups}${extGroup}

  _stanok_task_ids() {
    local -a ids
    ids=(\${(f)"$(stanok ls --format=ids 2>/dev/null)"})
    _describe 'task id' ids
  }

  if (( CURRENT == 2 )); then
    _describe -t workflow -V 'workflow' workflow
    _describe -t worktree -V 'worktree' git
    _describe -t setup -V 'setup' admin${describeExt}
    return
  fi

  case $words[2] in
    start)
      if (( CURRENT == 3 )); then
        _stanok_task_ids
      else
        _arguments \\
          '*--env=[KEY=VALUE]:env var:'
      fi
      ;;
    stop)
      if (( CURRENT == 3 )); then
        _stanok_task_ids
      else
        _arguments '--remove[Remove worktree]'
      fi
      ;;
    pr)
      _arguments '--build[Show build status]'
      ;;
    prune)
      _arguments '--dry-run[Show what would be pruned]'
      ;;
    mv|copy|run)
      if (( CURRENT == 3 )); then
        _stanok_task_ids
      fi
      ;;
    open)
      if (( CURRENT == 3 )); then
        _stanok_task_ids
      else
        _arguments '--terminal[Open in terminal]' '--finder[Open in Finder]'
      fi
      ;;
    diff)
      if (( CURRENT == 3 )); then
        _stanok_task_ids
      else
        _arguments '--stat[Show diffstat]'
      fi
      ;;
    completions)
      _values 'shell' zsh bash fish
      ;;
  esac
}

compdef _stanok stanok
`;
}

function bashScript(): string {
  const cached = readCommandsCache();
  const allCmds = [
    ...Object.values(COMMANDS).flatMap((g) => Object.keys(g)),
    ...Object.keys(cached),
  ].join(" ");

  return `_stanok() {
  local cur prev cmds task_cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${allCmds}"
  task_cmds="${TASK_ID_CMDS.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
    return
  fi

  local cmd="\${COMP_WORDS[1]}"

  if [[ \${COMP_CWORD} -eq 2 ]]; then
    for tc in \${task_cmds}; do
      if [[ "\${cmd}" == "\${tc}" ]]; then
        local ids
        ids="$(stanok ls --format=ids 2>/dev/null)"
        COMPREPLY=( $(compgen -W "\${ids}" -- "\${cur}") )
        return
      fi
    done
  fi

  case "\${cmd}" in
    start)
      COMPREPLY=( $(compgen -W "--env=" -- "\${cur}") )
      ;;
    stop)
      COMPREPLY=( $(compgen -W "--remove" -- "\${cur}") )
      ;;
    pr)
      COMPREPLY=( $(compgen -W "--build" -- "\${cur}") )
      ;;
    prune)
      COMPREPLY=( $(compgen -W "--dry-run --ls" -- "\${cur}") )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "zsh bash fish" -- "\${cur}") )
      ;;
  esac
}

complete -F _stanok stanok
`;
}

function fishScript(): string {
  const lines: string[] = [];
  const cached = readCommandsCache();

  lines.push("# Disable file completions by default");
  lines.push("complete -c stanok -f");
  lines.push("");

  // Subcommands
  for (const [, cmds] of Object.entries(COMMANDS)) {
    for (const [cmd, def] of Object.entries(cmds)) {
      lines.push(`complete -c stanok -n '__fish_use_subcommand' -a '${cmd}' -d '${def.desc}'`);
    }
  }

  // Plugin commands
  for (const [cmd, def] of Object.entries(cached)) {
    lines.push(`complete -c stanok -n '__fish_use_subcommand' -a '${cmd}' -d '${def.desc}'`);
  }
  lines.push("");

  // Task ID completions for relevant commands
  const taskIdCondition = TASK_ID_CMDS.map((c) => `__fish_seen_subcommand_from ${c}`).join("; or ");
  lines.push(`complete -c stanok -n '${taskIdCondition}' -a '(stanok ls --format=ids 2>/dev/null)'`);
  lines.push("");

  // Subcommand-specific flags
  const flags: [string, string, string][] = [
    ["start", "env", "Set env var (KEY=VALUE)"],
    ["stop", "remove", "Remove worktree"],
    ["pr", "build", "Show build status"],
    ["prune", "dry-run", "Show what would be pruned"],
    ["prune", "ls", "List prunable worktrees"],
    ["open", "terminal", "Open in terminal"],
    ["diff", "stat", "Show diffstat"],
    ["completions", "a", ""],
  ];

  for (const [cmd, flag, desc] of flags) {
    if (cmd === "completions") {
      lines.push(`complete -c stanok -n '__fish_seen_subcommand_from completions' -a 'zsh bash fish'`);
    } else {
      lines.push(`complete -c stanok -n '__fish_seen_subcommand_from ${cmd}' -l '${flag}' -d '${desc}'`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function cmdCompletions(args: string[]) {
  const shell = args[0];

  switch (shell) {
    case "zsh":
      process.stdout.write(zshScript());
      break;
    case "bash":
      process.stdout.write(bashScript());
      break;
    case "fish":
      process.stdout.write(fishScript());
      break;
    default:
      throw new WbError("Usage: stanok completions <zsh|bash|fish>");
  }
}

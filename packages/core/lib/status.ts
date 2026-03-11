import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { StatusConfig } from "./types";

const DEFAULT_STATUSES: Required<StatusConfig> = {
  open: ["Open", "Reopened", "Backlog"],
  inProgress: ["In Progress", "In Review", "In Testing", "Ready for Testing", "Stop Progress", "Stop Testing", "Pending"],
  done: ["Done", "Closed", "Resolved", "Tested", "Deployed"],
};

export function statusColor(status: string, config?: StatusConfig): string {
  const s = status.toLowerCase();
  const cfg = {
    open: (config?.open ?? DEFAULT_STATUSES.open).map((v) => v.toLowerCase()),
    inProgress: (config?.inProgress ?? DEFAULT_STATUSES.inProgress).map((v) => v.toLowerCase()),
    done: (config?.done ?? DEFAULT_STATUSES.done).map((v) => v.toLowerCase()),
  };

  if (cfg.done.includes(s)) return "Green";
  if (cfg.inProgress.includes(s)) return "Blue";
  if (cfg.open.includes(s)) return "SecondaryText";
  return "SecondaryText";
}

export function loadStatusConfig(home: string): StatusConfig {
  const p = join(home, ".stanok", "ui.json");
  if (!existsSync(p)) return {};
  try {
    const ui = JSON.parse(readFileSync(p, "utf-8"));
    return ui.statusColors || {};
  } catch {
    return {};
  }
}

import type { TaskMeta, TrackerIssue } from "./types";

export function filterTasks(
  tasks: TaskMeta[],
  searchText: string,
  parsedId: string | null,
): TaskMeta[] {
  return tasks.filter((t) => {
    if (!searchText) return true;
    if (parsedId) return t.task_id === parsedId;
    const lower = searchText.toLowerCase();
    const summary = (t.summary || "").toLowerCase();
    return t.task_id.toLowerCase().includes(lower) || summary.includes(lower);
  });
}

export function filterTrackerIssues(
  issues: TrackerIssue[],
  existingIds: Set<string>,
  searchText: string,
  parsedId: string | null,
): TrackerIssue[] {
  return issues
    .filter((i) => !existingIds.has(i.key))
    .filter((i) => {
      if (!searchText) return true;
      if (parsedId) return i.key === parsedId;
      const lower = searchText.toLowerCase();
      return i.key.toLowerCase().includes(lower) || i.summary.toLowerCase().includes(lower);
    });
}

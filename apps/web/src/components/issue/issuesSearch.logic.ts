import { pullRequestFilterProjects } from "@t3tools/client-runtime/pull-request-project-filter";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { IssuesSearch } from "./IssuesPage";

// The router reads a bare `key=42` as a number.
const bounded = (value: unknown): string | undefined => {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, 200) : undefined;
};

const labels = (raw: unknown): ReadonlyArray<string> | undefined => {
  const names = (Array.isArray(raw) ? raw : [raw]).flatMap((name) => bounded(name) ?? []);
  return names.length === 0 ? undefined : names.slice(0, 20);
};

// Every optional key is an own key, even when undefined: the router lays these over the parent
// route's unvalidated search, where a key left out would keep its raw value.
export const issuesSearchFromUrl = (raw: Record<string, unknown>): IssuesSearch => ({
  who:
    raw.who === "assigned" || raw.who === "authored" || raw.who === "mentioned" ? raw.who : "all",
  status: raw.status === "closed" || raw.status === "all" ? raw.status : "open",
  issueServer: bounded(raw.issueServer) as EnvironmentId | undefined,
  issueProject: bounded(raw.issueProject) as ProjectId | undefined,
  host: bounded(raw.host),
  q: bounded(raw.q),
  label: labels(raw.label),
  assignee: bounded(raw.assignee),
  order: raw.order === "created" ? "created" : undefined,
  selectedEnvironmentId: bounded(raw.selectedEnvironmentId) as EnvironmentId | undefined,
  selectedProjectId: bounded(raw.selectedProjectId) as ProjectId | undefined,
  selectedHost: bounded(raw.selectedHost),
  tracker: bounded(raw.tracker),
  scope: bounded(raw.scope),
  key: bounded(raw.key),
});

const TITLE_SEPARATOR = " · ";

// Same disambiguation the picker uses for equal titles: the server label,
// then the workspace root, then the environment id, then the project id.
const distinguishIssueFilterTitles = (
  projects: ReadonlyArray<EnvironmentProject>,
  environmentLabels: ReadonlyMap<EnvironmentId, string>,
) => {
  const distinguish = (
    items: ReadonlyArray<EnvironmentProject>,
    suffix: (project: EnvironmentProject) => string,
  ) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.title, (counts.get(item.title) ?? 0) + 1);
    return items.map((item) =>
      (counts.get(item.title) ?? 0) > 1
        ? { ...item, title: `${item.title}${TITLE_SEPARATOR}${suffix(item)}` }
        : item,
    );
  };
  const byServer = distinguish(
    projects,
    (project) => environmentLabels.get(project.environmentId) ?? project.environmentId,
  );
  const byPath = distinguish(byServer, (project) => project.workspaceRoot);
  const byEnvironment = distinguish(byPath, (project) => project.environmentId);
  return distinguish(byEnvironment, (project) => project.id);
};

/** One choice per project: projects on one repository can read different Linear teams. */
export const issueFilterProjects = (
  projects: ReadonlyArray<EnvironmentProject>,
  environmentLabels: ReadonlyMap<EnvironmentId, string>,
) => {
  const candidates = projects.filter((project) => !project.isScratch);
  const groups = distinguishIssueFilterTitles(candidates, environmentLabels).map((project) => ({
    label: project.title,
    memberProjectRefs: [{ environmentId: project.environmentId, projectId: project.id }],
  }));
  groups.sort((left, right) => left.label.localeCompare(right.label));
  return pullRequestFilterProjects(candidates, groups);
};

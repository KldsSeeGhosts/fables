import type { CaptainInboxItem } from "@t3tools/client-runtime/state/captains";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId } from "@t3tools/contracts";

type ActivityThread = Pick<
  EnvironmentThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "pendingSubagentRequest" | "updatedAt"
>;

/**
 * What a Duet row shows where desktop puts the time: what it waits on, else Working, else the
 * time of its last activity. Waiting wins because it needs the user.
 */
export type DuetRowTrail =
  | { readonly kind: "waiting"; readonly on: CaptainInboxItem["kind"] }
  | { readonly kind: "working" }
  | { readonly kind: "idle"; readonly at: string };

export function duetRowTrail(input: {
  readonly captain: Pick<Captain, "updatedAt">;
  readonly activity: {
    readonly primary: ActivityThread | undefined;
    readonly children: ReadonlyArray<ActivityThread>;
    readonly working: boolean;
  };
}): DuetRowTrail {
  const threads = [input.activity.primary, ...input.activity.children].filter(
    (thread) => thread !== undefined,
  );
  if (threads.some((thread) => thread.hasPendingApprovals))
    return { kind: "waiting", on: "approval" };
  if (threads.some((thread) => thread.hasPendingUserInput)) return { kind: "waiting", on: "input" };
  if (threads.some((thread) => thread.pendingSubagentRequest != null)) {
    return { kind: "waiting", on: "subagent-request" };
  }
  if (input.activity.working) return { kind: "working" };
  return { kind: "idle", at: input.activity.primary?.updatedAt ?? input.captain.updatedAt };
}

/** The second line's scope: one project with its badge, several, or every project. */
export type DuetRowScope =
  | { readonly kind: "project"; readonly title: string; readonly badge: string }
  | { readonly kind: "projects"; readonly count: number }
  | { readonly kind: "all" };

export function duetRowScope(
  environmentId: EnvironmentId,
  captain: Pick<Captain, "scopedProjectIds">,
  projects: ReadonlyArray<Pick<EnvironmentProject, "environmentId" | "id" | "title">>,
): DuetRowScope {
  const ids = captain.scopedProjectIds;
  if (ids.length === 0) return { kind: "all" };
  if (ids.length > 1) return { kind: "projects", count: ids.length };
  const project = projects.find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === ids[0],
  );
  if (project === undefined) return { kind: "projects", count: 1 };
  return { kind: "project", title: project.title, badge: projectBadge(project.title) };
}

/** Two letters for the project badge: the initials of a multi-word title, else its first two. */
export function projectBadge(title: string): string {
  const words = title.split(/[\s_\-./]+/).filter((word) => word !== "");
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? title).slice(0, 2);
  return letters.toUpperCase();
}

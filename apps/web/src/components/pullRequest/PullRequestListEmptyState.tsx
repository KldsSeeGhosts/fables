import { RefreshIcon } from "~/components/ui/refresh-icon";
import { T, useGT } from "gt-react";
import { FolderGit2Icon, PlusIcon, SearchIcon, ServerIcon, SettingsIcon } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 *
 * A list narrowed to nothing (search, filters) wears the design's small notice: one glyph, a
 * title, a sentence and the buttons that change the answer. A list with nothing to narrow (no
 * projects, signed out, nothing open) wears the app's page empty state instead: the list's own
 * ghost, a title, a sentence and hint tiles saying how rows get here.
 *
 */

import { openCommandPalette } from "../../commandPaletteBus";
import { PageEmptyState, PageEmptyTile, PageEmptyTiles } from "../PageEmptyState";
import { Button } from "../ui/button";
import { PullRequestListGhost } from "./PullRequestGhosts";
import { PullRequestGlyph } from "./pullRequestIcons";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

/** The list's one notice shape, shared with the page's unavailable and sign-in states. */
export function PullRequestListNotice({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ElementType<{ className?: string; "aria-hidden"?: boolean }>;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Empty size="compact">
      <Icon aria-hidden className="size-5.5 text-dim-foreground" />
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <div className="flex flex-wrap justify-center gap-2">{children}</div> : null}
    </Empty>
  );
}

/** The page empty state with the list's own rows as its ghost. */
function PullRequestPageEmpty({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageEmptyState
      fill
      ghost={<PullRequestListGhost idle rows={3} />}
      title={title}
      description={description}
    >
      {actions ? <div className="-mt-3 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      <PageEmptyTiles narrow>{children}</PageEmptyTiles>
    </PageEmptyState>
  );
}

function CheckAgainButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const gt = useGT();
  return (
    <Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
      <RefreshIcon size="sm" refreshing={refreshing} />
      {refreshing ? gt("Checking...") : gt("Check again")}
    </Button>
  );
}

export function PullRequestListEmptyState({
  query,
  filtered,
  filterSummary,
  searching,
  hasProjects,
  signIn,
  canLoadMore,
  loadingMore,
  refreshing,
  onClearQuery,
  onClearFilters,
  onShowAll,
  onLoadMore,
  onRefresh,
}: {
  query: string;
  filtered: boolean;
  /** The active filters as one sentence, said where the list would be. */
  filterSummary: string | null;
  searching: boolean;
  hasProjects: boolean;
  /**
   * Every host the projects live on is signed out or missing its CLI, so the empty list is not
   * an answer. Carries the host's own name and the server's words for the fix.
   */
  signIn: {
    hostLabel: string;
    changeRequestPlural: string;
    detail: string | null;
    Icon: ElementType;
  } | null;
  canLoadMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  onClearQuery: () => void;
  /** Puts every filter back to its default: open, all involvement, nothing narrowed. */
  onClearFilters: () => void;
  /** Widens the state filter from open to every pull request. */
  onShowAll: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}) {
  const gt = useGT();
  const shownQuery = query.length > 48 ? `${query.slice(0, 48)}…` : query;
  if (!hasProjects) {
    return (
      <PullRequestPageEmpty
        title={gt("No projects in this workspace")}
        description={gt("Add a project, and the pull requests from its repository appear here.")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openCommandPalette({ open: "add-project" })}
          >
            <PlusIcon className="size-3.5" />
            <T>Add project</T>
          </Button>
        }
      >
        <PageEmptyTile
          icon={<FolderGit2Icon />}
          title={gt("From its remote")}
          description={gt("Read from each project's GitHub or GitLab repository.")}
        />
        <PageEmptyTile
          icon={<ServerIcon />}
          title={gt("On this server")}
          description={gt("Uses the host's sign-in where T3 Code runs.")}
        />
      </PullRequestPageEmpty>
    );
  }

  // Ahead of the filters too: nothing they narrow was read.
  if (signIn) {
    return (
      <PullRequestPageEmpty
        title={gt("Sign in to {host}", { host: signIn.hostLabel })}
        description={
          signIn.detail ??
          gt("Sign in to {host} on this server to see {changeRequests}.", {
            host: signIn.hostLabel,
            changeRequests: signIn.changeRequestPlural,
          })
        }
        actions={<CheckAgainButton refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <PageEmptyTile
          icon={<ServerIcon />}
          title={gt("On this server")}
          description={gt("Sign in where T3 Code runs, not in this browser.")}
        />
        <PageEmptyTile
          icon={<SettingsIcon />}
          title={gt("Source control")}
          description={gt("Each host's sign-in, in settings.")}
        >
          <Button
            size="xs"
            variant="ghost"
            className="-ml-2 mt-1"
            render={<Link to="/settings/source-control" />}
          >
            {gt("Open settings")}
          </Button>
        </PageEmptyTile>
      </PullRequestPageEmpty>
    );
  }

  if (searching) {
    return (
      <PullRequestListGhost
        rows={5}
        caption={gt("Searching every host for “{query}”", { query: shownQuery })}
      />
    );
  }

  if (query.length > 0) {
    return (
      <PullRequestListNotice
        icon={SearchIcon}
        title={gt("Nothing matches “{query}”", { query: shownQuery })}
        description={gt(
          "The hosts were searched for it. Try fewer words, or search by number, author or branch.",
        )}
      >
        <Button size="sm" variant="secondary" onClick={onClearQuery}>
          {gt("Clear search")}
        </Button>
        <CheckAgainButton refreshing={refreshing} onRefresh={onRefresh} />
      </PullRequestListNotice>
    );
  }

  if (filtered) {
    return (
      <PullRequestListNotice
        icon={PullRequestGlyph.closed}
        title={gt("No pull requests match")}
        description={filterSummary ?? gt("Widen the filters to see more.")}
      >
        <Button size="sm" variant="secondary" onClick={onClearFilters}>
          {gt("Clear filters")}
        </Button>
        {/* The filters were only applied to the pages read so far. */}
        {canLoadMore ? (
          <Button size="sm" variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? gt("Loading...") : gt("Load more pull requests")}
          </Button>
        ) : null}
      </PullRequestListNotice>
    );
  }

  return (
    <PullRequestPageEmpty
      title={gt("No open pull requests")}
      description={gt("Open pull requests from every project in this workspace appear here.")}
      actions={
        <>
          {canLoadMore ? (
            <Button size="sm" variant="ghost" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? gt("Loading...") : gt("Load more pull requests")}
            </Button>
          ) : null}
          <CheckAgainButton refreshing={refreshing} onRefresh={onRefresh} />
        </>
      }
    >
      <PageEmptyTile
        icon={<PullRequestGlyph.pullRequest />}
        title={gt("From a thread")}
        description={gt("Create PR in a thread's git menu, and it lands here.")}
      />
      <PageEmptyTile
        icon={<PullRequestGlyph.merged />}
        title={gt("Closed and merged")}
        description={gt("Every pull request, not only open ones.")}
      >
        <Button size="xs" variant="ghost" className="-ml-2 mt-1" onClick={onShowAll}>
          {gt("Show all")}
        </Button>
      </PageEmptyTile>
    </PullRequestPageEmpty>
  );
}

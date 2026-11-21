import type { ScopedThreadRef } from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useGT } from "gt-react";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { resolvePullRequestState } from "./pullRequestPresentation";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";

import { changeRequestTermKind } from "./changeRequestTerm";

interface CrumbsPullRequest {
  readonly url: string;
  readonly provider: string;
  readonly number: number;
  readonly repository: string;
  readonly title: string;
  readonly state: "open" | "merged" | "closed";
  readonly isDraft: boolean;
}

const openNumberContextMenu = (event: ReactMouseEvent, detail: CrumbsPullRequest): void => {
  event.preventDefault();
  event.stopPropagation();
  void showPullRequestLinkContextMenu({
    url: detail.url,
    openLabel: openOnHostLabel(sourceControlClients.get(detail.provider)),
    position: { x: event.clientX, y: event.clientY },
  });
};

function BackButton({
  onBack,
  focusable,
  plural,
}: {
  onBack: () => void;
  focusable: boolean;
  plural: string;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            {...(focusable ? {} : { tabIndex: -1 })}
            onClick={onBack}
            className="-ms-1.25"
            aria-label={gt("Back to this thread's {term}", { term: plural })}
          >
            <ArrowLeftIcon aria-hidden className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top">{gt("Back to {term}", { term: plural })}</TooltipPopup>
    </Tooltip>
  );
}

function NumberLink({
  detail,
  threadRef,
  toneClassName,
  openOnHostText,
  focusable,
}: {
  detail: CrumbsPullRequest;
  threadRef: ScopedThreadRef | null;
  toneClassName: string;
  openOnHostText: string;
  focusable: boolean;
}) {
  const gt = useGT();
  const openLink = useOpenLink(threadRef);
  return (
    <span className={cn("inline-flex shrink-0", toneClassName)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone={null}
              {...(focusable ? {} : { tabIndex: -1 })}
              onClick={(event) => void openLink(detail.url, { event }).catch(console.error)}
              onAuxClick={(event) => {
                if (event.button === 1) void openLink(detail.url, { event }).catch(console.error);
              }}
              onContextMenu={(event) => openNumberContextMenu(event, detail)}
              aria-label={gt(
                "Open {term, select, mr {merge request} cr {change request} other {pull request}} #{number} on host",
                {
                  term: changeRequestTermKind(
                    sourceControlClients.get(detail.provider).changeRequest,
                  ),
                  number: detail.number,
                },
              )}
            >
              #{detail.number}
              <ExternalLinkIcon aria-hidden className="size-[13px]" />
            </InlineButton>
          }
        />
        <TooltipPopup side="top">{openOnHostText}</TooltipPopup>
      </Tooltip>
    </span>
  );
}

/**
 * The repository and number above the title.
 */
export function PullRequestDetailCrumbs({
  detail,
  threadRef,
  toneClassName,
  repositoryUrl,
  openOnHostText,
  onBack,
  children,
}: {
  detail: CrumbsPullRequest | null;
  threadRef: ScopedThreadRef | null;
  toneClassName: string | null;
  repositoryUrl: string | null;
  openOnHostText: string;
  onBack: (() => void) | undefined;
  children?: ReactNode;
}) {
  const gt = useGT();
  const openLink = useOpenLink(threadRef);
  const state = detail ? resolvePullRequestState(detail) : null;
  return (
    <div className="mt-2 flex min-h-6 min-w-0 items-center gap-1.5 pl-4 text-label text-muted-foreground">
      {detail && toneClassName && state ? (
        <>
          {onBack ? (
            <BackButton
              onBack={onBack}
              focusable
              plural={sourceControlClients.get(detail.provider).changeRequest.plural}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                repositoryUrl ? (
                  <InlineButton
                    tone="muted"
                    className="min-w-16 shrink @max-sm/pr-header:hidden"
                    onClick={(event) =>
                      void openLink(repositoryUrl, { event }).catch(console.error)
                    }
                  >
                    <span className="truncate">{detail.repository}</span>
                  </InlineButton>
                ) : (
                  <span className="min-w-16 truncate @max-sm/pr-header:hidden">
                    {detail.repository}
                  </span>
                )
              }
            />
            <TooltipPopup side="top">
              {repositoryUrl
                ? gt("Open {repository} repository", { repository: detail.repository })
                : detail.repository}
            </TooltipPopup>
          </Tooltip>
          <NumberLink
            detail={detail}
            threadRef={threadRef}
            toneClassName={toneClassName}
            openOnHostText={openOnHostText}
            focusable
          />
          {detail.state !== "open" || detail.isDraft ? (
            <Badge
              size="status"
              variant={
                detail.state === "merged"
                  ? "merged"
                  : detail.state === "closed"
                    ? "error"
                    : "secondary"
              }
            >
              <state.Icon aria-hidden />
              <span className="@max-sm/pr-header:sr-only">{state.label}</span>
            </Badge>
          ) : null}
          {children}
        </>
      ) : null}
    </div>
  );
}

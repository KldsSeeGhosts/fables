import {
  compareForkUpstream,
  T3_UPSTREAM_REPOSITORY,
  upstreamMergePrompt,
  upstreamReviewUrl,
} from "@t3tools/shared/forkUpstream";
import { msg, T, useGT, Var } from "gt-react";
import { CircleArrowUpIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "~/state/query";
import { includedUpstreamVersion, upstreamNightlyAtom } from "~/state/upstreamNightly";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Upstream changes are reviewed and merged into KSG, never installed over it. */
export function UpstreamNightlySettings() {
  const query = useEnvironmentQuery(upstreamNightlyAtom);
  const latest = query.data;
  const gt = useGT();
  const status =
    latest === null ? null : compareForkUpstream(includedUpstreamVersion, latest.version);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "upstream merge prompt",
      unavailableMessage: msg("Clipboard API is unavailable while copying upstream merge prompt."),
      failureMessage: msg("Failed to copy upstream merge prompt to the clipboard."),
    },
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy merge prompt"),
          description: error.message,
        }),
      ),
  });

  const isBehind = status === "behind" && latest !== null && !query.error;
  const lastCheckedTooltip = latest
    ? gt("Last checked {time}", {
        time: new Date(latest.checkedAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      })
    : null;
  const refreshTooltip = lastCheckedTooltip ?? gt("Check upstream");

  return (
    <SettingsRow
      id={searchableSetting("upstream-nightly").id}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            <T>Upstream</T>
          </span>
          {includedUpstreamVersion ? (
            <code className="text-meta text-muted-foreground">{includedUpstreamVersion}</code>
          ) : null}
          {isBehind ? (
            <Badge size="sm" variant="info">
              <CircleArrowUpIcon />
              <T>Update available</T>
            </Badge>
          ) : null}
        </span>
      }
      description={
        <span aria-live="polite">
          {query.error ? (
            <T>
              Could not check upstream. <Var>{String(query.error)}</Var>
            </T>
          ) : !latest ? (
            <T>
              Checking <Var>{T3_UPSTREAM_REPOSITORY}</Var>…
            </T>
          ) : status === "behind" ? (
            <T>
              <Var>
                <code className="text-meta text-foreground">{latest.version}</code>
              </Var>{" "}
              is ready to review and merge.
            </T>
          ) : status === "current" ? (
            <T>
              Up to date with <Var>{T3_UPSTREAM_REPOSITORY}</Var>.
            </T>
          ) : (
            <T>
              Latest nightly:{" "}
              <Var>
                <code className="text-meta text-foreground">{latest.version}</code>
              </Var>
              .
            </T>
          )}
        </span>
      }
      control={
        <div className="flex flex-wrap items-center gap-2">
          {isBehind ? (
            <>
              <Button
                render={
                  <a
                    href={upstreamReviewUrl(includedUpstreamVersion, latest.version)}
                    target="_blank"
                    rel="noreferrer noopener"
                  />
                }
                size="sm"
                variant="secondary"
              >
                <T>Review changes</T>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copyToClipboard(upstreamMergePrompt(latest.version), undefined)}
              >
                {isCopied ? <T>Copied</T> : <T>Copy merge prompt</T>}
              </Button>
            </>
          ) : latest && !query.error ? (
            <Button
              render={
                <a
                  href={upstreamReviewUrl(includedUpstreamVersion, latest.version)}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
              size="sm"
              variant="secondary"
            >
              <T>View upstream</T>
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                isBehind ? (
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    aria-label={query.isPending ? gt("Checking upstream…") : gt("Check upstream")}
                    disabled={query.isPending}
                    onClick={query.refresh}
                  >
                    <RefreshIcon refreshing={query.isPending} />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={query.isPending}
                    onClick={query.refresh}
                  >
                    {query.isPending ? <T>Checking…</T> : <T>Check upstream</T>}
                  </Button>
                )
              }
            />
            {isBehind || lastCheckedTooltip ? (
              <TooltipPopup side="top">
                {isBehind ? refreshTooltip : lastCheckedTooltip}
              </TooltipPopup>
            ) : null}
          </Tooltip>
        </div>
      }
    />
  );
}

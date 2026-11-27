/* oxlint-disable shadcn/no-arbitrary-values -- the hairline falls back to --border outside the ksg-salon theme, as quiet-pill does. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainBriefItems,
  captainBriefVisible,
  captainDigestNewSection,
  captainDigestRest,
} from "@t3tools/client-runtime/state/captain-digest";
import { captainPaletteOf } from "@t3tools/client-runtime/state/captain-palette";
import { captainDocument } from "@t3tools/client-runtime/state/captains";
import type { Captain, EnvironmentId } from "@t3tools/contracts";
import { T, useGT, useLocale } from "gt-react";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { Button, ContentButton } from "../ui/button";
import { Text } from "../ui/text";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CaptainAvatar } from "./CaptainAvatar";
import { openCaptainTasks } from "./captainBriefTab";
import { useCaptains } from "./useCaptain";

export interface MorningBriefDuet {
  readonly environmentId: EnvironmentId;
  readonly captain: Captain;
  readonly working: boolean;
}

type OpenCaptain = (environmentId: EnvironmentId, captain: Captain) => void;

function briefDay(updatedAt: string, now: Date): "today" | "yesterday" | "older" {
  const day = new Date(updatedAt);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(day, now)) return "today";
  return same(day, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    ? "yesterday"
    : "older";
}

function Freshness({ updatedAt, now }: { updatedAt: string; now: Date }) {
  const gt = useGT();
  const locale = useLocale();
  const day = new Date(updatedAt);
  const kind = briefDay(updatedAt, now);
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(day);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Text
            variant="meta"
            tone={kind === "today" ? "default" : "muted"}
            numeric
            render={<time dateTime={updatedAt} />}
          />
        }
      >
        {kind === "today" ? (
          gt("Today at {time}", {
            time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
              day,
            ),
          })
        ) : kind === "yesterday" ? (
          <T>Yesterday</T>
        ) : (
          new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
            ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
          }).format(day)
        )}
      </TooltipTrigger>
      <TooltipPopup>{fullDate}</TooltipPopup>
    </Tooltip>
  );
}

/** Stable keys for entries that can repeat: the text plus how many times it has appeared. */
function keyed<T extends string | { readonly kind: string }>(entries: ReadonlyArray<T>) {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { key: `${text}#${count}`, entry };
  });
}

function MorningBrief({
  environmentId,
  captain,
  working,
  now,
  onOpenCaptain,
}: MorningBriefDuet & { now: Date; onOpenCaptain: OpenCaptain }) {
  const gt = useGT();
  const nameId = useId();
  const listId = useId();
  const restId = useId();
  const [expanded, setExpanded] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const details = useCaptains(environmentId, captain.id);
  const document = captainDocument(details.data, captain.id, "DIGEST.md");
  const content = document?.content ?? "";
  const loading = details.data === null && details.error === null;
  if (!loading && details.error === null && content.trim() === "") return null;
  const newSection = captainDigestNewSection(content);
  const brief = newSection ?? content.trim();
  const rest = captainDigestRest(content);
  const entries = captainBriefItems(brief, { boldLabels: captain.kind === "chorus" });
  const { visible, collapsible, hiddenCount } = captainBriefVisible(entries, expanded);

  const controls =
    collapsible || rest !== "" ? (
      <div className="-ms-2 mt-2 flex flex-wrap gap-1">
        {collapsible ? (
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <T>Show fewer</T> : gt("Show {count} more", { count: hiddenCount })}
          </Button>
        ) : null}
        {rest !== "" ? (
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            aria-expanded={restOpen}
            aria-controls={restId}
            onClick={() => setRestOpen((open) => !open)}
          >
            {restOpen ? <T>Hide the rest of the digest</T> : <T>Rest of the digest</T>}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <li className="border-t border-[var(--duet-hairline,var(--border))] py-6 first:border-t-0 first:pt-0 last:pb-3">
      <article
        data-duet-brief=""
        data-duet-palette={captainPaletteOf(captain.avatar)}
        aria-labelledby={nameId}
        className="flex min-w-0 flex-col gap-3 @min-[80rem]/duets-page:-ms-50 @min-[80rem]/duets-page:grid @min-[80rem]/duets-page:grid-cols-[11rem_minmax(0,1fr)] @min-[80rem]/duets-page:gap-x-6 @min-[80rem]/duets-page:gap-y-0"
      >
        <header className="flex min-w-0 items-center gap-3 @min-[80rem]/duets-page:flex-col @min-[80rem]/duets-page:items-start @min-[80rem]/duets-page:gap-0.5">
          <div className="-ms-2 w-fit min-w-0 max-w-full">
            <ContentButton
              variant="inset-row-multiline"
              aria-label={gt("Open {name}'s conversation", { name: captain.name })}
              onClick={() => onOpenCaptain(environmentId, captain)}
            >
              <CaptainAvatar
                avatar={captain.avatar}
                size="header"
                state={working ? "working" : "idle"}
              />
              <span className="grid min-w-0">
                <Text variant="label" truncate id={nameId}>
                  {captain.name}
                </Text>
                {captain.role ? (
                  <Text variant="meta" tone="muted" truncate>
                    {captain.role}
                  </Text>
                ) : null}
              </span>
            </ContentButton>
          </div>
          {document !== undefined && details.error === null ? (
            <span className="ms-auto shrink-0 @min-[80rem]/duets-page:ms-0 @min-[80rem]/duets-page:ps-6.5">
              <Freshness updatedAt={document.updatedAt} now={now} />
            </span>
          ) : null}
        </header>
        <div
          data-duet-brief-body=""
          className="ms-2 min-w-0 border-s-2 border-border ps-4 @min-[80rem]/duets-page:ms-0"
        >
          {loading ? (
            <Text variant="body" tone="muted" render={<p />}>
              <T>Loading the recap…</T>
            </Text>
          ) : details.error !== null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Text variant="body" tone="muted" render={<p />}>
                <T>The recap could not be loaded.</T>
              </Text>
              <Button type="button" variant="ghost-muted" size="xs" onClick={details.refresh}>
                <T>Retry</T>
              </Button>
            </div>
          ) : newSection === "" ? (
            <>
              <Text variant="body" tone="muted" render={<p />}>
                <T>Nothing new since the last recap.</T>
              </Text>
              {controls}
            </>
          ) : (
            <>
              <ul role="list" id={listId} className="flex flex-col gap-3">
                {keyed(visible).map(({ key, entry }) => {
                  if (entry.kind === "label") {
                    return (
                      <li key={key}>
                        <Text variant="meta" tone="muted" render={<h4 />}>
                          {entry.text}
                        </Text>
                      </li>
                    );
                  }
                  const sideRefs = entry.references.length > 0 && entry.references.length <= 2;
                  return (
                    <li
                      key={key}
                      data-duet-brief-item=""
                      className={cn(
                        "grid min-w-0 grid-cols-[minmax(0,68ch)] gap-y-1.5",
                        sideRefs &&
                          "@min-[44rem]/briefs:grid-cols-[minmax(0,68ch)_12rem] @min-[44rem]/briefs:gap-x-6",
                      )}
                    >
                      <ChatMarkdown
                        text={entry.markdown}
                        cwd={undefined}
                        environmentId={environmentId}
                        className="text-body leading-relaxed"
                      />
                      {entry.references.length > 0 ? (
                        <div
                          className={cn(
                            "flex min-w-0 flex-wrap gap-x-3 gap-y-1",
                            sideRefs &&
                              "@min-[44rem]/briefs:col-start-2 @min-[44rem]/briefs:row-start-1 @min-[44rem]/briefs:flex-col @min-[44rem]/briefs:flex-nowrap @min-[44rem]/briefs:pt-0.5",
                          )}
                        >
                          {keyed(entry.references).map(
                            ({ key: referenceKey, entry: reference }) => (
                              <div
                                key={referenceKey}
                                className="min-w-0 max-w-full [&_p]:my-0 [&_p]:truncate"
                              >
                                <ChatMarkdown
                                  text={reference}
                                  cwd={undefined}
                                  environmentId={environmentId}
                                  className="text-meta text-muted-foreground"
                                />
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {controls}
            </>
          )}
          {restOpen && rest !== "" ? (
            <div
              id={restId}
              className="mt-3 border-t border-[var(--duet-hairline,var(--border))] pt-3"
            >
              <ChatMarkdown
                text={rest}
                cwd={undefined}
                environmentId={environmentId}
                className="text-body leading-relaxed text-muted-foreground"
              />
            </div>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function MissingBriefPill({
  environmentId,
  captain,
  onOpenCaptain,
}: Omit<MorningBriefDuet, "working"> & { onOpenCaptain: OpenCaptain }) {
  const gt = useGT();
  const details = useCaptains(environmentId, captain.id);
  const document = captainDocument(details.data, captain.id, "DIGEST.md");
  if (details.data === null || details.error !== null) return null;
  if ((document?.content ?? "").trim() !== "") return null;
  return (
    <Button
      type="button"
      variant="quiet-pill"
      size="sm"
      data-duet-brief-missing-duet=""
      aria-label={gt("Set up the recap for {name}", { name: captain.name })}
      onClick={() => {
        openCaptainTasks(scopeThreadRef(environmentId, captain.primaryThreadId), "scheduled");
        onOpenCaptain(environmentId, captain);
      }}
    >
      <CaptainAvatar avatar={captain.avatar} size="row" state="idle" />
      {captain.name}
    </Button>
  );
}

/** One uncarded row per Duet with a brief, then a strip of the Duets without one. */
export function MorningBriefs({
  duets,
  now,
  onOpenCaptain,
}: {
  duets: ReadonlyArray<MorningBriefDuet>;
  now: Date;
  onOpenCaptain: OpenCaptain;
}) {
  return (
    <>
      <ol role="list" className="@container/briefs flex flex-col empty:hidden">
        {duets.map((duet) => (
          <MorningBrief
            key={`${duet.environmentId}:${duet.captain.id}`}
            {...duet}
            now={now}
            onOpenCaptain={onOpenCaptain}
          />
        ))}
      </ol>
      <div
        data-duet-briefs-missing=""
        className="flex flex-wrap items-center gap-2 border-t border-[var(--duet-hairline,var(--border))] pt-4 [ol:empty+&]:border-t-0 [ol:empty+&]:pt-0 [&:not(:has([data-duet-brief-missing-duet]))]:hidden"
      >
        <Text variant="meta" tone="muted">
          <T>No recap yet</T>
        </Text>
        {duets.map(({ environmentId, captain }) => (
          <MissingBriefPill
            key={`${environmentId}:${captain.id}`}
            environmentId={environmentId}
            captain={captain}
            onOpenCaptain={onOpenCaptain}
          />
        ))}
        <p className="basis-full text-meta text-muted-foreground">
          <T>Turn on the recap in Tasks → Scheduled.</T>
        </p>
      </div>
    </>
  );
}

import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { BoxIcon, CalendarRangeIcon, GaugeIcon, Minimize2Icon, TimerIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import type { MessageResolver } from "../../i18n/messages";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ContextWindowSegments } from "./ContextWindowSegments";
import { contextWindowSegments } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { nextPoolReset, poolSources, resolveThreadDetailsLimits } from "./ThreadDetailsUsage.logic";

const USAGE_ROW_CLASS =
  "col-span-full grid min-w-0 grid-cols-subgrid items-center gap-x-1.5 text-meta";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};
export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}
type UsageTone = "error" | "warning" | null;

function limitTone(left: number): UsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

/** Provider limits share the canvas's icon and label columns. */
export function ThreadDetailsUsage({
  providerInstanceId,
  model,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const gt = useGT();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  if (!resolved) return null;

  return (
    <ThreadDetailsSection title={gt("Usage limits")} variant="usage">
      {resolved.kind === "pool" ? (
        resolved.windows.map((window) => <PoolRow key={window.id} window={window} now={now} />)
      ) : (
        <InstanceRows limits={resolved.limits} now={now} />
      )}
    </ThreadDetailsSection>
  );
}

function InstanceRows({
  limits,
  now,
}: {
  readonly limits: ServerProviderUsageLimits;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const notice = limitsNotice(limits, m);
  if (notice) {
    return (
      <UsageRow
        label={gt("Limits", { $context: "usage limits row label" })}
        icon={<TimerIcon />}
        fill={null}
        tone={null}
        value={gt("Unavailable")}
        tooltip={<span className="text-foreground">{notice}</span>}
        opensUsage
      />
    );
  }
  return limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />);
}

/** Context fills as tokens are used. Compact follows the composer's real provider command. */
export function ThreadDetailsContext({
  usage,
  onCompact,
  compactUnavailableReason,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly onCompact?: (() => void) | undefined;
  /** Why compacting cannot start now; the button stays hoverable to say so. */
  readonly compactUnavailableReason?: string | null | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const [collapsed, setCollapsed] = useLocalStorage(
    "thread-details:collapsed:Context breakdown",
    true,
    Schema.Boolean,
  );
  if (!usage) {
    return (
      <ThreadDetailsSection title={gt("Context window")} variant="usage">
        <UsageRow
          label={gt("Context", { $context: "context window row label" })}
          icon={<GaugeIcon />}
          fill={null}
          tone={null}
          value={gt("N/A")}
          tooltip={gt("The provider has not reported context usage.")}
        />
      </ThreadDetailsSection>
    );
  }
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used = maxTokens !== null ? Math.max(0, Math.min(100, usage.usedPercentage ?? 0)) : null;
  const tokens =
    maxTokens !== null
      ? `${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(maxTokens)}`
      : `${formatContextWindowTokens(usage.usedTokens)} tokens`;
  const tokensAria = maxTokens !== null ? gt("{tokens} tokens", { tokens }) : tokens;
  return (
    <ThreadDetailsSection title={gt("Context window")} variant="usage">
      <Collapsible
        className="col-span-full grid grid-cols-subgrid"
        open={!collapsed}
        onOpenChange={(open) => setCollapsed(!open)}
      >
        <div className={cn(USAGE_ROW_CLASS, "h-8")}>
          <CollapsibleTrigger
            render={<ThreadDetailsControl part="usage" />}
            aria-label={
              used !== null
                ? gt("Context: {usage}, {used}% used", {
                    usage: tokensAria,
                    used: Math.round(used),
                  })
                : gt("Context: {usage}", { usage: tokensAria })
            }
          >
            <GaugeIcon className="size-4 shrink-0" />
            <span className="flex h-6 items-center text-foreground">{gt("Context")}</span>
            <span className={cn("flex items-center gap-1.5", onCompact && "pe-7.5")}>
              <span className="min-w-12 flex-1">
                {used !== null ? <ContextWindowSegments usage={usage} minSegmentWidth={2} /> : null}
              </span>
              <span className="shrink-0 text-end tabular-nums text-muted-foreground">
                {used !== null ? `${Math.round(used)}%` : ""}
              </span>
            </span>
          </CollapsibleTrigger>
          <span className="col-start-3 row-start-1 flex justify-self-end">
            {onCompact ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="secondary"
                      aria-label={gt("Compact context")}
                      aria-disabled={compactUnavailableReason ? true : undefined}
                      onClick={compactUnavailableReason ? undefined : onCompact}
                    />
                  }
                >
                  <Minimize2Icon className="size-[13px]" />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {compactUnavailableReason ?? gt("Compact context")}
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </span>
        </div>
        <CollapsiblePanel className="col-span-full">
          <div className="px-0.5 pb-0.5">
            <div className="surface-composer rounded-lg p-0.5">
              <dl className="text-meta">
                {contextWindowSegments(usage).map((segment) => (
                  <div
                    key={segment.label}
                    className="flex h-8 items-center justify-between gap-2 px-2.5"
                  >
                    <dt className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-xs", segment.color)}
                      />
                      {segment.label}
                    </dt>
                    <dd className="text-caption tabular-nums text-muted-foreground">
                      {segment.tokens.toLocaleString(locale)}
                    </dd>
                  </div>
                ))}
                <div className="flex min-h-8 items-center justify-between gap-2 px-2.5">
                  <dt>{maxTokens !== null ? gt("Used / max") : gt("Used")}</dt>
                  <dd className="text-caption tabular-nums text-muted-foreground">
                    {usage.usedTokens.toLocaleString(locale)}
                    {maxTokens !== null ? ` / ${maxTokens.toLocaleString(locale)}` : null}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </ThreadDetailsSection>
  );
}

function resetLabel(
  window: ServerProviderUsageWindow,
  now: number,
  resolve: MessageResolver,
): string | null {
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const remainingMs = resetsAt - now;
  if (!(remainingMs > 0)) return null;
  return isWeeklyWindow(window)
    ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(resetsAt)
    : formatDuration(remainingMs, resolve);
}

function isWeeklyWindow(window: ServerProviderUsageWindow): boolean {
  return (window.windowDurationMins ?? 0) >= 24 * 60 || /week/i.test(window.label);
}

function LimitRow({
  window,
  now,
  pooledAccounts = 1,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly pooledAccounts?: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const remainingMs = resetsAt - now;
  const weekly = isWeeklyWindow(window);
  const modelLabel =
    weekly && window.id.startsWith("seven_day_")
      ? /^Weekly\s*·\s*(.+)$/i.exec(window.label)?.[1]
      : undefined;
  const reset = resetLabel(window, now, m);
  return (
    <UsageRow
      label={modelLabel ?? window.label}
      shortLabel={weekly && !modelLabel ? window.label.replace(/\s*·\s*Weekly$/i, "") : undefined}
      icon={modelLabel ? <BoxIcon /> : weekly ? <CalendarRangeIcon /> : <TimerIcon />}
      fill={left}
      tone={limitTone(left)}
      tick={timeLeft}
      value={`${left}%`}
      ariaValue={gt("{left}% left", { left })}
      trailing={
        reset ? (
          <span className="whitespace-nowrap text-caption text-dim-foreground">{reset}</span>
        ) : undefined
      }
      opensUsage
      tooltip={
        <>
          <span className="text-foreground">
            {gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {window.resetsAt && remainingMs > 0 ? (
            <span>
              <span className="block">
                {pooledAccounts > 1
                  ? gt("Next reset in {duration}", {
                      duration: formatDuration(remainingMs, m),
                    })
                  : gt("Resets in {duration}", {
                      duration: formatDuration(remainingMs, m),
                    })}
              </span>
              <span className="block">
                {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)}
              </span>
            </span>
          ) : null}
          {pace ? <span>{m(PACE_LABEL[pace])}</span> : null}
          {pace && timeLeft !== null ? (
            <span className="block">{gt("{timeLeft}% of the window left", { timeLeft })}</span>
          ) : null}
          {pooledAccounts > 1 ? (
            <span>{gt("Across {count} accounts", { count: pooledAccounts })}</span>
          ) : null}
        </>
      }
    />
  );
}

function PoolRow({ window, now }: { readonly window: LimitPoolWindow; readonly now: number }) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const from = poolSources(window);
  const sourceLabels = [...from.hubs, ...(from.signedIn ? [gt("Signed-in accounts")] : [])];
  const next = nextPoolReset(window, now);
  const resetsAt = next?.member.window.resetsAt;
  const reset =
    next && resetsAt
      ? {
          duration: formatDuration(next.at - now, m),
          time: formatUpcomingTimestamp(resetsAt, timestampFormat, now, undefined, m),
        }
      : null;
  return (
    <UsageRow
      label={window.label}
      icon={<TimerIcon />}
      fill={left}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaValue={gt("{left}% left", { left })}
      opensUsage
      tooltip={
        <>
          <span className="text-foreground">
            {accounts > 1
              ? gt("{label}: {left}% left across {accounts} accounts", {
                  label: window.label,
                  left,
                  accounts,
                })
              : gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {window.pace ? (
            <span className="text-muted-foreground">{m(PACE_LABEL[window.pace])}</span>
          ) : null}
          {next && reset ? (
            <span className="text-muted-foreground">
              {accounts > 1
                ? gt("+{percent}% in {duration}, {time}", {
                    percent: next.restoresPercent,
                    ...reset,
                  })
                : gt("Resets in {duration}, {time}", reset)}
            </span>
          ) : null}
          {sourceLabels.length > 0 ? (
            <span className="text-muted-foreground">
              {gt("From {sources}", { sources: sourceLabels.join(", ") })}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. With `opensUsage` it links to the usage page. */
function UsageRow({
  label,
  shortLabel,
  icon,
  fill,
  tone,
  tick = null,
  value,
  ariaValue = value,
  tooltip,
  trailing,
  muted = false,
  opensUsage = false,
}: {
  readonly label: string;
  readonly shortLabel?: string | undefined;
  readonly icon: ReactNode;
  readonly fill: number | null;
  readonly tone: UsageTone;
  readonly tick?: number | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly trailing?: ReactNode;
  readonly muted?: boolean;
  readonly opensUsage?: boolean;
}) {
  const gt = useGT();
  const triggerClassName =
    "col-span-full grid min-w-0 grid-cols-subgrid items-center gap-x-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <Tooltip>
      <div className={cn(USAGE_ROW_CLASS, "h-8")}>
        <TooltipTrigger
          render={
            opensUsage ? (
              <Link
                to="/usage"
                aria-label={gt("{label}: {value}", { label, value: ariaValue })}
                className={cn(triggerClassName, "cursor-pointer")}
              />
            ) : (
              <div
                tabIndex={0}
                aria-label={gt("{label}: {value}", { label, value: ariaValue })}
                className={cn(triggerClassName, "cursor-default")}
              />
            )
          }
        >
          <span className="shrink-0 text-muted-foreground [&>svg]:size-4">{icon}</span>
          {shortLabel && shortLabel !== label ? (
            <UsageLabel key={label} label={label} shortLabel={shortLabel} />
          ) : (
            <span className="truncate">{label}</span>
          )}
          <span className="flex items-center justify-end gap-1.5">
            {fill !== null ? (
              <span className="relative h-1 min-w-12 flex-1 rounded-full bg-muted-foreground/20">
                {fill > 0 ? (
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      tone === "error"
                        ? "bg-error"
                        : tone === "warning"
                          ? "bg-warning"
                          : muted
                            ? "bg-muted-foreground"
                            : "bg-foreground/80",
                    )}
                    style={{ width: `max(${fill}%, 2px)` }}
                  />
                ) : null}
                {tick !== null ? (
                  <span
                    aria-hidden
                    className="absolute -top-[3px] h-2.5 w-0.5 rounded-sm bg-muted-foreground"
                    style={{ left: `${tick}%` }}
                  />
                ) : null}
              </span>
            ) : null}
            <span
              className={cn(
                "shrink-0 whitespace-nowrap text-end tabular-nums text-muted-foreground",
                tone === "error" && "text-error-foreground",
                tone === "warning" && "text-warning-foreground",
              )}
            >
              {value}
            </span>
            {fill !== null && trailing ? <span className="shrink-0">{trailing}</span> : null}
          </span>
        </TooltipTrigger>
      </div>
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5 text-muted-foreground">
          {tooltip}
          {opensUsage ? <span>{gt("Open usage")}</span> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function UsageLabel({
  label,
  shortLabel,
}: {
  readonly label: string;
  readonly shortLabel: string;
}) {
  const fullLabel = useRef<HTMLSpanElement>(null);
  const [shortened, setShortened] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- chooses the shorter label only when the grid's measured space cannot fit the full label
  useLayoutEffect(() => {
    const element = fullLabel.current;
    if (!element) return;
    const measure = () => setShortened(element.scrollWidth > element.clientWidth);
    measure();
    return observeResize(element, measure);
  }, []);
  return (
    <span className="relative min-w-0">
      {/* The full label retains its intrinsic width so shortening cannot oscillate the grid. */}
      <span ref={fullLabel} className={cn("block truncate", shortened && "invisible")}>
        {label}
      </span>
      {shortened ? <span className="absolute inset-0 truncate">{shortLabel}</span> : null}
    </span>
  );
}

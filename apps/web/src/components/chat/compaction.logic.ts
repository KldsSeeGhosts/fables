import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { msg } from "gt-react";

import { getActiveLocale, m, type MessageResolver } from "../../i18n/messages";
import {
  resolveSelectableProviderInstanceEntry,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function providerSupportsManualCompaction(
  provider: ProviderInstanceEntry | null | undefined,
): boolean {
  return provider?.snapshot.slashCommands.some((command) => command.name === "compact") ?? false;
}

export function hasAvailableCompactionProvider(input: {
  readonly providers: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId | null;
  readonly lockedInstanceId: ProviderInstanceId | null;
}): boolean {
  const driverProviders = input.providers.filter(
    (provider) => provider.driverKind === input.driverKind,
  );
  const lockedContinuationGroupKey = input.lockedInstanceId
    ? driverProviders.find((provider) => provider.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey
    : undefined;
  const compatibleProviders = lockedContinuationGroupKey
    ? driverProviders.filter(
        (provider) => provider.continuationGroupKey === lockedContinuationGroupKey,
      )
    : driverProviders;

  return providerSupportsManualCompaction(
    resolveSelectableProviderInstanceEntry(compatibleProviders, input.instanceId ?? undefined),
  );
}

export function formatContextWindowCompactionMessage(
  autoCompactThreshold?: number | null,
  resolve: MessageResolver = m,
  locale: string = getActiveLocale(),
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return resolve(
      msg("Compacts automatically at about {tokens} tokens.", {
        tokens: autoCompactThreshold.toLocaleString(locale),
      }),
    );
  }
  return resolve(msg("Context compacts automatically when needed."));
}

/** Cache and reasoning are subsets of input and output. Unclassified context
 * stays visible when a provider reports only part of the usage. */
export function contextWindowSegments(
  usage: Pick<
    ContextWindowSnapshot,
    "usedTokens" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningOutputTokens"
  >,
) {
  const input = usage.inputTokens ?? usage.cachedInputTokens ?? 0;
  const cached = Math.min(input, usage.cachedInputTokens ?? 0);
  const output = usage.outputTokens ?? usage.reasoningOutputTokens ?? 0;
  const reasoning = Math.min(output, usage.reasoningOutputTokens ?? 0);
  const reported = [
    { label: "Cached input", tokens: cached, color: "bg-black/80 dark:bg-white/80" },
    { label: "New input", tokens: input - cached, color: "bg-black/50 dark:bg-white/50" },
    { label: "Output", tokens: output - reasoning, color: "bg-black/32 dark:bg-white/32" },
    { label: "Reasoning", tokens: reasoning, color: "bg-black/20 dark:bg-white/20" },
  ];
  let remaining = usage.usedTokens;
  const segments = reported.flatMap((segment) => {
    const tokens = Math.max(0, Math.min(remaining, segment.tokens));
    remaining -= tokens;
    return tokens > 0 ? [{ ...segment, tokens }] : [];
  });
  if (remaining > 0 || segments.length === 0) {
    segments.push({
      label: segments.length ? "Other context" : "Used context",
      tokens: remaining,
      color: "bg-black/80 dark:bg-white/80",
    });
  }
  return segments;
}

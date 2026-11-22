import {
  EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  collectProviderUsageLimits,
  displayLimitWindows,
  hubRoutes,
  instanceHubs,
  usageLimitsForModel,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { limitsNotice } from "@t3tools/shared/usageLimitsCopy";

export type ThreadDetailsLimits =
  | { readonly kind: "instance"; readonly limits: ServerProviderUsageLimits }
  | { readonly kind: "pool"; readonly windows: readonly LimitPoolWindow[] };

// collectLimitAccounts keys its input by environment; the card reads one, so any id serves.
const CARD_ENVIRONMENT = EnvironmentId.make("thread-details");

export function resolveThreadDetailsLimits(
  providerInstanceId: ProviderInstanceId | null,
  model: string | null,
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  now: number,
): ThreadDetailsLimits | null {
  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  if (!provider) return null;
  const own = provider.usageLimits;
  if (own && limitsNotice(own) === null) {
    const report = collectProviderUsageLimits(provider.instanceId, providers, sources, now, model);
    return {
      kind: "instance",
      limits:
        report?.accounts.find((account) => account.instanceId === provider.instanceId)?.limits ??
        own,
    };
  }

  const hubs = instanceHubs(provider, sources);
  const accounts = collectRoutedHubLimitAccounts(
    provider.driver,
    model,
    providers,
    hubs,
    CARD_ENVIRONMENT,
  );
  const windows = collectLimitPools(accounts, now).flatMap(displayLimitWindows);
  if (windows.length > 0) return { kind: "pool", windows };
  return own ? { kind: "instance", limits: own } : null;
}

export function nextPoolReset(window: LimitPoolWindow, now: number) {
  const pooled = window.members.length > 1;
  return (
    window.resets.find((reset) => reset.at > now && (!pooled || reset.restoresPercent > 0)) ?? null
  );
}

export function collectRoutedHubLimitAccounts(
  driver: ServerProvider["driver"],
  model: string | null,
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  environmentId: EnvironmentId,
) {
  const routes = hubRoutes(sources, driver, model);
  const routed = sources.map((source) => ({
    ...source,
    accounts: source.accounts.filter(routes).map((account) => ({
      ...account,
      usageLimits: usageLimitsForModel(account.driver, account.usageLimits, model),
    })),
  }));
  const readable = routed
    .flatMap((source) => source.accounts)
    .filter((account) => limitsNotice(account.usageLimits) === null);
  if (readable.length === 0) return [];
  // A signed-in login joins the pool only as a fresher reading of an account the hub routes to.
  const signedIn = providers
    .filter((provider) =>
      readable.some(
        (account) =>
          account.driver === provider.driver &&
          account.workspaceId === provider.auth.workspaceId &&
          account.email !== undefined &&
          account.email.toLowerCase() === provider.auth.email?.toLowerCase(),
      ),
    )
    .map((provider) =>
      provider.usageLimits
        ? {
            ...provider,
            usageLimits: usageLimitsForModel(provider.driver, provider.usageLimits, model),
          }
        : provider,
    );
  return collectLimitAccounts(
    new Map([
      [
        environmentId,
        {
          entry: { target: { label: "" } },
          serverConfig: { providers: signedIn, usageLimitSources: routed },
        },
      ],
    ]),
  );
}

export function poolSources(window: LimitPoolWindow) {
  const hubs = window.members.flatMap(({ account }) =>
    account.environments.length === 0 && account.sourceLabel ? [account.sourceLabel] : [],
  );
  const signedIn = window.members.some(({ account }) => account.environments.length > 0);
  return { hubs: [...new Set(hubs)], signedIn };
}

import type { UsageLimitSourceAccount } from "@t3tools/contracts";
import { collectCpaAccountGroups, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";

function Account({
  account,
  now,
}: {
  readonly account: UsageLimitSourceAccount;
  readonly now: number;
}) {
  const gt = useGT();
  return (
    <li className="space-y-2 border-t py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="break-all text-label">
            <RedactedSensitiveText
              value={account.label ?? account.email ?? account.id}
              ariaLabel={gt("Reveal CPA account")}
              revealTooltip={gt("Show account")}
              hideTooltip={gt("Hide account")}
            />
          </p>
          {account.fileName && account.fileName !== account.label ? (
            <p className="break-all text-meta text-muted-foreground">
              <RedactedSensitiveText
                value={account.fileName}
                ariaLabel={gt("Reveal auth filename")}
                revealTooltip={gt("Show auth filename")}
                hideTooltip={gt("Hide auth filename")}
              />
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-meta text-muted-foreground">
          <span>{account.providerLabel ?? account.driver}</span>
          {account.plan ? <span>{account.plan}</span> : null}
          {account.disabled ? (
            <span>
              <T>Disabled</T>
            </span>
          ) : null}
          {account.synthetic ? (
            <span>
              <T>Dashboard account</T>
            </span>
          ) : null}
        </div>
      </div>
      {account.usageLimits.windows.map((window) => (
        <p key={window.id} className="flex flex-wrap justify-between gap-2 text-meta tabular-nums">
          <span>
            {window.estimated ? (
              <T>
                <Var>{window.label}</Var> (estimated)
              </T>
            ) : (
              <T>
                <Var>{window.label}</Var>
              </T>
            )}
          </span>
          <span className="flex gap-2">
            <span>
              <T>
                <Var>{remainingPercent(window)}</Var>% left
              </T>
            </span>
            {window.resetsAt ? <span>{formatResetsIn(window, now)}</span> : null}
          </span>
        </p>
      ))}
      {account.usageLimits.unavailable ? (
        <p className="text-meta text-muted-foreground">
          {account.usageLimits.unavailable.message ?? <T>Quota unavailable.</T>}
        </p>
      ) : null}
      {account.notice ? <p className="text-meta text-muted-foreground">{account.notice}</p> : null}
    </li>
  );
}

function Group({
  group,
  now,
}: {
  readonly group: ReturnType<typeof collectCpaAccountGroups>[number];
  readonly now: number;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const count = group.source.accounts.length;
  return (
    <section className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-label">{group.label}</h2>
          <p className="text-meta text-muted-foreground">
            <T>
              <Var>{count}</Var> CPA accounts, including disabled and unavailable auth files
            </T>
          </p>
        </div>
        <Button
          variant="secondary"
          size="xs"
          aria-expanded={expanded}
          aria-label={expanded ? gt("Hide accounts") : gt("Show accounts")}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <T>Hide accounts</T> : <T>Show accounts</T>}
        </Button>
      </div>
      {expanded ? (
        <ul className="mt-3">
          {group.source.accounts.map((account) => (
            <Account key={account.id} account={account} now={now} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CpaAccounts({
  groups,
  now,
}: {
  readonly groups: ReturnType<typeof collectCpaAccountGroups>;
  readonly now: number;
}) {
  return groups.map((group) => <Group key={group.key} group={group} now={now} />);
}

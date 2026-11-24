/* oxlint-disable shadcn/no-raw-colors, shadcn/no-arbitrary-values -- The V3 Duet spec fixes these exact static status-ring colors. */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { CircleCheck } from "lucide-react";

export type CaptainTaskRingStatus = "needs-input" | "working" | "ready" | "scheduled" | "done";

export function captainTaskRingStatus(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingUserInput"
    | "hasPendingApprovals"
    | "pendingSubagentRequest"
    | "runtime"
    | "latestRun"
    | "settledAt"
  >,
): CaptainTaskRingStatus {
  if (thread.hasPendingUserInput || thread.hasPendingApprovals || thread.pendingSubagentRequest) {
    return "needs-input";
  }
  if (threadRuntimeIsActive(thread.runtime)) return "working";
  if (thread.settledAt !== null) return "done";
  if (thread.latestRun?.status === "completed") return "ready";
  return "done";
}

/** The Duet task state glyph. Every ring is static SVG; scanning never repaints it. */
export function CaptainTaskRing({ status }: { readonly status: CaptainTaskRingStatus }) {
  if (status === "done") {
    return <CircleCheck aria-hidden className="size-3.5 shrink-0 text-[#838383]" />;
  }
  return (
    <svg aria-hidden viewBox="0 0 14 14" className="size-3.5 shrink-0" fill="none">
      {status === "needs-input" ? (
        <>
          <circle cx="7" cy="7" r="5.5" stroke="#a98546" strokeWidth="1.5" />
          <path d="M7 1.5A5.5 5.5 0 0 0 7 12.5Z" fill="#a98546" />
        </>
      ) : status === "working" ? (
        <path
          d="M7 1.5a5.5 5.5 0 1 1-3.89 1.61"
          stroke="#d97757"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : status === "ready" ? (
        <>
          <circle cx="7" cy="7" r="5.5" stroke="#1e7d2c" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="1.75" fill="#1e7d2c" />
        </>
      ) : (
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="#a3a3a3"
          strokeWidth="1.5"
          strokeDasharray="2.5 2.5"
        />
      )}
    </svg>
  );
}

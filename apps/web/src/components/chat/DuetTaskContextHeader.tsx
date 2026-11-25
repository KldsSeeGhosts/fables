/* oxlint-disable t3code/no-styled-raw-controls, shadcn/no-arbitrary-values, t3code/no-raw-type-classes, t3code/no-dot-separated-text -- the task context row is a semantic jump link with Duet-specific connector geometry, not a shared button control. */
import { createContext, useContext } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useGT, T } from "gt-react";
import { MessageCircle } from "lucide-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import type { DuetPalette } from "../captains/captainPalette";
import { useCaptainTaskStatusLabel } from "../captains/CaptainTaskRing";
import { captainThreadTaskStatus } from "../captains/captainTaskStatus.logic";
import type { DuetStreamKind } from "./duetStream.logic";

export interface DuetStreamContextValue {
  readonly enabled: boolean;
  readonly kind: DuetStreamKind;
  readonly captainRef: ScopedThreadRef | null;
  readonly palette: DuetPalette | null;
  readonly timestampDividers: ReadonlyMap<string, string>;
  readonly taskHeaders: ReadonlyMap<string, ThreadId>;
  readonly childThreads: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly threadTitles: ReadonlyMap<string, string>;
}

const DUET_STREAM_CONTEXT_DEFAULT: DuetStreamContextValue = {
  enabled: false,
  kind: "editorial",
  captainRef: null,
  palette: null,
  timestampDividers: new Map(),
  taskHeaders: new Map(),
  childThreads: new Map(),
  threadTitles: new Map(),
};

export const DuetStreamContext = createContext<DuetStreamContextValue>(DUET_STREAM_CONTEXT_DEFAULT);

/** The curved inline connector that names the Captain task an assistant bubble is speaking about. */
export function DuetTaskContextHeader({
  captainRef,
  childThreadId,
}: {
  readonly captainRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
}) {
  const gt = useGT();
  const stream = useContext(DuetStreamContext);
  const childRef = scopeThreadRef(captainRef.environmentId, childThreadId);
  const liveShell = useQuietThreadShell(childRef);
  const shell = liveShell ?? stream.childThreads.get(childThreadId) ?? null;
  const statusLabel = useCaptainTaskStatusLabel(captainThreadTaskStatus(shell));
  const title = shell?.title.trim() || gt("Task", { $context: "Captain delegated task" });
  return (
    <button
      type="button"
      data-duet-task-header={childThreadId}
      className="mb-1 flex h-5 min-w-0 max-w-full cursor-pointer items-end gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={gt("Open task {title}", { title })}
      onClick={() => useRightPanelStore.getState().openThread(captainRef, childThreadId)}
    >
      <span
        aria-hidden
        className="mb-[-1px] h-2.5 w-3 shrink-0 rounded-tl-lg border-t-[1.5px] border-l-[1.5px] border-[#d4d4d4] dark:border-[#444]"
      />
      <MessageCircle aria-hidden className="mb-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate pb-0.5 text-[13.5px] leading-none text-foreground">
        {title}
        <span className="text-muted-foreground"> · {statusLabel}</span>
      </span>
      <span className="sr-only">
        <T>Open task</T>
      </span>
    </button>
  );
}

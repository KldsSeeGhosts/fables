import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainSubagentTaskStatus,
  captainTaskActivityMs,
  captainTaskDetail,
  captainThreadTaskStatus,
  type CaptainTaskStatus,
} from "@t3tools/client-runtime/state/captain-tasks";
import { captainRecentlyFinishedTasks } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { relativeTime } from "../../lib/time";
import { useLinkedThreadReach } from "../../state/linkedThread";
import { environmentThreadDetails } from "../../state/threads";
import { subagentThreadTarget } from "../threads/threadAgentsPresentation";
import { useOpenLinkedThreadRead } from "../threads/useOpenLinkedThread";
import { CAPTAIN_TASK_STATUS_LABELS } from "./captainLabels";
import type { CaptainOverviewRow } from "./captainOverview";
import { CaptainTaskRing } from "./CaptainTaskRing";

const DETAILED_CAPTAINS = 3;
const FINISHED_PER_CAPTAIN = 3;
const NO_SUBAGENTS: ReadonlyArray<OrchestrationV2Subagent> = [];

const overviewDelegationsAtom = Atom.family((key: string) => {
  const targets = JSON.parse(key) as ReadonlyArray<readonly [EnvironmentId, ThreadId]>;
  return Atom.make((get) =>
    targets.map(
      ([environmentId, threadId]) =>
        get(environmentThreadDetails.quietThreadAtom(scopeThreadRef(environmentId, threadId)))
          ?.projection.subagents ?? NO_SUBAGENTS,
    ),
  ).pipe(
    Atom.withEquality<ReadonlyArray<ReadonlyArray<OrchestrationV2Subagent>>>((a, b) =>
      a.every((tasks, index) => tasks === b[index]),
    ),
    Atom.setIdleTTL(0),
  );
});

export type OverviewTask =
  | { readonly captainRow: CaptainOverviewRow; readonly thread: EnvironmentThreadShell }
  | { readonly captainRow: CaptainOverviewRow; readonly subagent: OrchestrationV2Subagent };

export function useCaptainOverviewTasks(rows: ReadonlyArray<CaptainOverviewRow>, visible: boolean) {
  const detailed = [...rows]
    .sort(
      (a, b) =>
        Number(b.captain.kind === "chorus") - Number(a.captain.kind === "chorus") ||
        Number(b.activity.attention > 0) - Number(a.activity.attention > 0) ||
        Number(b.activity.working) - Number(a.activity.working) ||
        b.captain.updatedAt.localeCompare(a.captain.updatedAt),
    )
    .slice(0, DETAILED_CAPTAINS);
  const delegations = useAtomValue(
    overviewDelegationsAtom(
      JSON.stringify(
        visible
          ? detailed.map(({ environment, captain }) => [
              environment.environmentId,
              captain.primaryThreadId,
            ])
          : [],
      ),
    ),
  );
  const inFlight: OverviewTask[] = rows.flatMap((captainRow) =>
    [...captainRow.activity.children]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((thread) => ({ captainRow, thread })),
  );
  const finished: OverviewTask[] = [];
  detailed.forEach((captainRow, index) => {
    const tasks = delegations[index] ?? NO_SUBAGENTS;
    for (const subagent of tasks) {
      if (
        subagent.origin === "app_owned" &&
        subagent.remoteChild !== undefined &&
        isOrchestrationV2WorkActive(subagent.status)
      )
        inFlight.push({ captainRow, subagent });
    }
    for (const subagent of captainRecentlyFinishedTasks(tasks, FINISHED_PER_CAPTAIN)) {
      finished.push({ captainRow, subagent });
    }
  });
  return { inFlight, finished };
}

export function overviewTaskKey(task: OverviewTask) {
  const { environment, captain } = task.captainRow;
  return "thread" in task
    ? `${environment.environmentId}:${task.thread.id}`
    : `${environment.environmentId}:${captain.id}:${task.subagent.id}`;
}

function TaskRow(props: {
  readonly name: string;
  readonly title: string;
  readonly status: CaptainTaskStatus;
  readonly detail: string | null;
  readonly activityMs: number;
  readonly nowMs: number;
  readonly onOpen: (() => void) | null;
}) {
  const m = useMessages();
  const status = m(CAPTAIN_TASK_STATUS_LABELS[props.status]);
  const elapsed = relativeTime(new Date(props.activityMs).toISOString(), props.nowMs, m);
  return (
    <Pressable
      accessible
      accessibilityRole={props.onOpen === null ? "text" : "button"}
      accessibilityLabel={[props.title, props.name, status, props.detail]
        .filter(Boolean)
        .join(", ")}
      disabled={props.onOpen === null}
      onPress={props.onOpen ?? undefined}
      className="min-h-14 flex-row items-center gap-3 rounded-xl px-2 py-2 active:bg-subtle"
    >
      <CaptainTaskRing status={props.status} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-t3-medium text-sm text-foreground" numberOfLines={2}>
          {props.title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={2}>
          {[props.name, status, props.detail].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Text className="text-xs text-foreground-muted">{elapsed}</Text>
    </Pressable>
  );
}

function DelegationRow(props: {
  readonly captainRow: CaptainOverviewRow;
  readonly subagent: OrchestrationV2Subagent;
  readonly nowMs: number;
}) {
  const navigation = useNavigation();
  const gt = useGT();
  const openLinked = useOpenLinkedThreadRead();
  const { captain, environment } = props.captainRow;
  const { subagent } = props;
  const reach = useLinkedThreadReach(environment.environmentId, [subagent]);
  const target = subagentThreadTarget(
    subagent,
    environment.environmentId,
    reach.ownConnection,
    reach.isLinked,
  );
  const status = captainSubagentTaskStatus(subagent);
  const title = subagent.title ?? subagent.remoteChild?.title ?? gt("Subagent");
  return (
    <TaskRow
      name={captain.name}
      title={title}
      status={status}
      detail={captainTaskDetail({ status, subagent }) ?? subagent.remoteChild?.label ?? null}
      activityMs={captainTaskActivityMs({ status, subagent })}
      nowMs={props.nowMs}
      onOpen={
        target === null
          ? null
          : () => {
              if (target.linked) openLinked(target, target.linked, title);
              else
                navigation.dispatch(
                  StackActions.push("Thread", {
                    environmentId: target.environmentId,
                    threadId: target.threadId,
                  }),
                );
            }
      }
    />
  );
}

export function CaptainOverviewTaskRow(props: {
  readonly task: OverviewTask;
  readonly nowMs: number;
}) {
  const navigation = useNavigation();
  const { task, nowMs } = props;
  if ("subagent" in task) return <DelegationRow {...task} nowMs={nowMs} />;

  const { thread } = task;
  const status = captainThreadTaskStatus(thread);
  return (
    <TaskRow
      name={task.captainRow.captain.name}
      title={thread.title}
      status={status}
      detail={captainTaskDetail({ status, thread })}
      activityMs={captainTaskActivityMs({ status, thread })}
      nowMs={nowMs}
      onOpen={() =>
        navigation.dispatch(
          StackActions.push("Thread", { environmentId: thread.environmentId, threadId: thread.id }),
        )
      }
    />
  );
}

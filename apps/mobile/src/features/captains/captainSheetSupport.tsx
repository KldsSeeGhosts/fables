import { useAtomValue } from "@effect/atom-react";
import { threadFamilyRead, type ThreadFamilyRead } from "@t3tools/client-runtime/state/threads";
import { ThreadId, type Captain, type EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadFamilies } from "../../state/threads";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import type { CaptainEnvironment } from "./useCaptainsDirectory";

/**
 * Closes the sheet, then selects the thread as Home's rows do, so a split view keeps its list
 * and replaces only the detail column.
 */
export function useOpenThreadFromSheet() {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  return (environmentId: EnvironmentId, threadId: ThreadId) => {
    if (navigation.canGoBack()) navigation.goBack();
    selectDetail({
      name: "Thread",
      params: { environmentId: String(environmentId), threadId: String(threadId) },
    });
  };
}

/** One line for each environment still loading or that failed, so neither reads as empty. */
export function CaptainEnvironmentNotices(props: {
  readonly environments: ReadonlyArray<CaptainEnvironment>;
}) {
  const gt = useGT();
  const notices = props.environments.filter(({ status }) => status !== "ready");
  if (notices.length === 0) return null;
  const named = props.environments.length > 1;
  return (
    <View className="gap-1 px-3 pb-2">
      {notices.map(({ environmentId, label, status }) => (
        <Text
          key={environmentId}
          className={
            status === "failed" ? "text-xs text-danger-foreground" : "text-xs text-foreground-muted"
          }
        >
          {status === "failed"
            ? named
              ? gt("Could not load Captains from {environment}.", { environment: label })
              : gt("Could not load Captains.")
            : named
              ? gt("Loading Captains from {environment}…", { environment: label })
              : gt("Loading Captains…")}
        </Text>
      ))}
    </View>
  );
}

const familyReadsAtom = Atom.family((joined: string) =>
  Atom.make((get): ReadonlyArray<ThreadFamilyRead> =>
    joined === ""
      ? []
      : joined.split("\n").map((line) => {
          const [environmentId, threadId] = JSON.parse(line) as [EnvironmentId, ThreadId];
          return threadFamilyRead(get(threadFamilies.familyAtom(environmentId, threadId)));
        }),
  ).pipe(Atom.withLabel(`mobile-captain-family-reads:${joined}`)),
);

/**
 * The shell leaves out idle crew threads, so this loads the families of the listed Captains'
 * conversations for as long as the list shows, as desktop's Tasks drawer does.
 */
export function useCaptainFamilies(
  groups: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly captains: ReadonlyArray<Pick<Captain, "primaryThreadId" | "earlierThreadIds">>;
  }>,
): ThreadFamilyRead {
  const joined = groups
    .flatMap(({ environmentId, captains }) =>
      captains.flatMap((captain) =>
        [captain.primaryThreadId, ...captain.earlierThreadIds].map((threadId) =>
          JSON.stringify([environmentId, threadId]),
        ),
      ),
    )
    .join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds each listed conversation's family rows in the shared shell while the list shows
  useEffect(() => {
    if (joined === "") return;
    const releases = joined.split("\n").map((line) => {
      const [environmentId, threadId] = JSON.parse(line) as [EnvironmentId, string];
      return threadFamilies.mount(appAtomRegistry, environmentId, ThreadId.make(threadId));
    });
    return () => {
      for (const release of releases) release();
    };
  }, [joined]);
  const reads = useAtomValue(familyReadsAtom(joined));
  if (reads.includes("pending")) return "pending";
  return reads.includes("failed") ? "failed" : "settled";
}

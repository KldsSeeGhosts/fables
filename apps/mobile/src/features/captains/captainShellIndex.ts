import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isCaptainThreadId,
  type Captain,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export function createCaptainDirectoryShellsAtom(
  shells: Atom.Atom<ReadonlyArray<EnvironmentThreadShell>>,
) {
  return Atom.map(shells, (threads) =>
    threads.filter(
      ({ id, lineage }) =>
        isCaptainThreadId(id) ||
        (lineage.relationshipToParent === "subagent" &&
          lineage.parentThreadId !== null &&
          isCaptainThreadId(lineage.parentThreadId)),
    ),
  ).pipe(
    Atom.withEquality<ReadonlyArray<EnvironmentThreadShell>>(
      (previous, next) =>
        previous.length === next.length &&
        previous.every((thread, index) => thread === next[index]),
    ),
    Atom.withLabel("mobile-captain-directory-shells"),
  );
}

/** `threads` without Captain conversations, the same array when none of them are in it. */
export function withoutCaptainConversations(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  joinedKeys: string,
): ReadonlyArray<EnvironmentThreadShell> {
  if (joinedKeys === "") return threads;
  const keys = new Set(joinedKeys.split("\n"));
  const kept = threads.filter((thread) => !keys.has(threadShellKey(thread)));
  return kept.length === threads.length ? threads : kept;
}

const threadShellKey = (thread: EnvironmentThreadShell) =>
  threadKey({ environmentId: thread.environmentId, threadId: thread.id });

/**
 * Each Captain's conversations and the threads under them, bucketed in one pass over the shells
 * so a list of Captains does not rescan every shell per Captain.
 */
export function captainShellsByConversation(
  shells: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>> {
  const byConversation = new Map<string, EnvironmentThreadShell[]>();
  const add = (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    thread: EnvironmentThreadShell,
  ) => {
    const key = threadKey({ environmentId, threadId });
    const bucket = byConversation.get(key);
    if (bucket) bucket.push(thread);
    else byConversation.set(key, [thread]);
  };
  for (const thread of shells) {
    if (isCaptainThreadId(thread.id)) add(thread.environmentId, thread.id, thread);
    const parent = thread.lineage.parentThreadId;
    if (parent !== null && thread.lineage.relationshipToParent === "subagent") {
      add(thread.environmentId, parent, thread);
    }
  }
  return byConversation;
}

/** The shells one Captain reads: its conversations and their crews. */
export function captainShells(
  byConversation: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>,
  environmentId: EnvironmentId,
  captain: Pick<Captain, "primaryThreadId" | "earlierThreadIds">,
): ReadonlyArray<EnvironmentThreadShell> {
  return [captain.primaryThreadId, ...captain.earlierThreadIds].flatMap(
    (threadId) => byConversation.get(threadKey({ environmentId, threadId })) ?? [],
  );
}

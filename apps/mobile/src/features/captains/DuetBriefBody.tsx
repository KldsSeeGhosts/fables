import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { Captain, CaptainMemory, EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOpenThreadFromSheet } from "./captainSheetSupport";
import { DuetCreature } from "./DuetCreature";
import { duetRowScope } from "./duetHomeRow";
import { useDuetTokens } from "./useDuetTokens";

function Section(props: {
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const tokens = useDuetTokens();
  return (
    <View className="px-4 pb-3.5 pt-3" style={{ borderTopWidth: 1, borderColor: tokens.hairline }}>
      <View className="h-8 flex-row items-center gap-2">
        <SymbolView name={props.icon} size={14} tintColor={tokens.icon} />
        <Text className="font-t3-medium" style={{ fontSize: 13, color: tokens.muted }}>
          {props.title}
        </Text>
      </View>
      {props.children}
    </View>
  );
}

/**
 * The Duet shell's Brief: who the Duet is, New conversation, then previews of its digest, notes
 * and essential memories. Editing stays on desktop.
 */
export function DuetBriefBody(props: {
  readonly environmentId: EnvironmentId;
  readonly captain: Captain;
  readonly digest: ReactNode | null;
  readonly notes: ReactNode | null;
  readonly memories: ReadonlyArray<CaptainMemory>;
}) {
  const gt = useGT();
  const tokens = useDuetTokens();
  const { captain, environmentId } = props;
  const projects = useProjects();
  const environmentLabel = useEnvironments().environments.find(
    (environment) => environment.environmentId === environmentId,
  )?.label;
  const scope = duetRowScope(environmentId, captain, projects);
  const scopeText =
    scope.kind === "project"
      ? scope.title
      : scope.kind === "projects"
        ? gt("{count, plural, =1 {1 project} other {{count} projects}}", { count: scope.count })
        : gt("All projects");
  const canReset = useAtomValue(
    serverEnvironment.resetCaptainConversation.permissionAtom(environmentId),
  );
  const reset = useAtomCommand(serverEnvironment.resetCaptainConversation, {
    label: "duet new conversation",
    reportFailure: false,
  });
  const openThread = useOpenThreadFromSheet();
  const startNewConversation = () =>
    Dialog.confirm({
      title: gt("Start a new conversation?"),
      message: gt(
        "A new conversation will keep this Duet’s documents, memories and scheduled tasks. You can still open the earlier conversation.",
      ),
      confirmText: gt("New conversation"),
      onConfirm: () => {
        void reset({
          environmentId,
          input: { captainId: captain.id, expectedThreadId: captain.primaryThreadId },
        }).then((result) => {
          if (result._tag === "Success") openThread(environmentId, result.value.primaryThreadId);
          else
            Dialog.alert(
              gt("Could not reset conversation."),
              String(squashAtomCommandFailure(result)),
            );
        });
      },
    });
  const empty = (text: string) => (
    <Text style={{ fontSize: 14, lineHeight: 21, color: tokens.muted }}>{text}</Text>
  );
  return (
    <>
      <View className="flex-row items-center gap-3.5 px-4 pb-3.5 pt-2">
        <DuetCreature captain={captain} size={56} disc animateOnMount />
        <View className="min-w-0 flex-1">
          <Text
            style={{ fontSize: 20, lineHeight: 26, color: tokens.foreground }}
            className="font-t3-bold"
            numberOfLines={1}
          >
            {captain.name}
          </Text>
          {captain.role.trim() ? (
            <Text style={{ fontSize: 14, lineHeight: 19, color: tokens.muted }} numberOfLines={2}>
              {captain.role}
            </Text>
          ) : null}
          <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.meta }} numberOfLines={1}>
            {environmentLabel ? `${scopeText} · ${environmentLabel}` : scopeText}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={!canReset}
        onPress={startNewConversation}
        className="mx-4 mb-2.5 h-11 flex-row items-center justify-center gap-2 rounded-xl"
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: tokens.panelBorder,
          backgroundColor: pressed ? tokens.row : tokens.composer,
          opacity: canReset ? 1 : 0.5,
        })}
      >
        <SymbolView name="plus.bubble" size={17} tintColor={tokens.foreground} />
        <Text className="font-t3-medium" style={{ fontSize: 15, color: tokens.foreground }}>
          {gt("New conversation")}
        </Text>
      </Pressable>
      <Section icon="doc.text" title={gt("New in the digest")}>
        {props.digest === null ? (
          empty(gt("Nothing new yet."))
        ) : (
          <View
            className="max-h-[118px] overflow-hidden rounded-xl px-3 py-2.5"
            style={{
              backgroundColor: tokens.overview,
              borderWidth: 1,
              borderColor: tokens.hairline,
            }}
          >
            {props.digest}
          </View>
        )}
      </Section>
      <Section icon="text.alignleft" title={gt("Notes")}>
        {props.notes ?? empty(gt("No notes yet."))}
      </Section>
      <Section icon="pin" title={gt("Always remembers")}>
        {props.memories.length === 0
          ? empty(gt("No essential memories yet."))
          : props.memories.map((memory) => (
              <View key={memory.id} className="flex-row items-start gap-[9px] py-[5px]">
                <View className="pt-0.5">
                  <SymbolView name="pin" size={13} tintColor={tokens.icon} />
                </View>
                <Text
                  className="min-w-0 flex-1"
                  style={{ fontSize: 14, lineHeight: 20, color: tokens.foreground }}
                >
                  {memory.text}
                </Text>
              </View>
            ))}
      </Section>
    </>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { captainDocument } from "@t3tools/client-runtime/state/captains";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  captainDigestMarkdownExcerpt,
  captainDigestNewSection,
} from "@t3tools/client-runtime/state/captain-digest";
import { AuthOrchestrationReadScope, CaptainId, EnvironmentId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope, useEnvironmentScopeDenied } from "../../state/session";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { useAtomCommand } from "../../state/use-atom-command";
import { CaptainOrb } from "./CaptainOrb";
import { DuetBriefBody } from "./DuetBriefBody";
import { useDuetShell } from "./useDuetShell";

export type CaptainBriefParams = {
  readonly environmentId: string;
  readonly captainId: string;
};

function BriefSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2 border-t border-border-subtle px-4 py-4">
      <Text className="font-t3-medium text-xs text-foreground-muted">{props.title}</Text>
      {props.children}
    </View>
  );
}

/**
 * What a Captain knows, read only: its notes, what is new in its digest, and the memories it
 * always carries. Editing stays on the desktop app.
 */
export function CaptainBriefSheet({ route }: StaticScreenProps<CaptainBriefParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const isDuet = useDuetShell();
  const markdownStyle = useMarkdownPreviewStyles().nativeTextStyle;
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const captainId = CaptainId.make(route.params.captainId);
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const readDenied = useEnvironmentScopeDenied(environmentId, AuthOrchestrationReadScope);
  const live = useEnvironmentQuery(
    canRead ? serverEnvironment.captainsLive({ environmentId, input: { captainId } }) : null,
  );
  const captain = live.data?.captains.find((candidate) => candidate.id === captainId);
  const notes = captainDocument(live.data, captainId, "NOTES.md")?.content.trim() ?? "";
  const digest = captainDocument(live.data, captainId, "DIGEST.md")?.content ?? "";
  // Only a digest with no `## New` section falls back to its excerpt; an empty one is empty.
  const digestNew =
    captainDigestNewSection(digest) ?? captainDigestMarkdownExcerpt(digest).markdown;
  const unavailable = readDenied
    ? gt("You cannot read Duets in this environment.")
    : live.error !== null && live.data === null
      ? live.error
      : live.data !== null && captain === undefined
        ? gt("This Duet no longer exists.")
        : null;
  const memories = (live.data?.memories ?? []).filter(
    (memory) => memory.captainId === captainId && memory.essential,
  );
  const archive = useAtomCommand(serverEnvironment.archiveCaptain, { reportFailure: false });
  const restore = useAtomCommand(serverEnvironment.unarchiveCaptain, { reportFailure: false });
  const canArchive = useAtomValue(serverEnvironment.archiveCaptain.permissionAtom(environmentId));
  const canRestore = useAtomValue(serverEnvironment.unarchiveCaptain.permissionAtom(environmentId));
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archived = captain?.archivedAt !== null;
  const changeArchive = async () => {
    if (captain === undefined || archivePending || !(archived ? canRestore : canArchive)) return;
    setArchivePending(true);
    setArchiveError(null);
    const result = await (archived ? restore : archive)({
      environmentId,
      input: { captainId: captain.id },
    });
    setArchivePending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setArchiveError(
        failure instanceof Error ? failure.message : gt("Could not update the Chorus."),
      );
    }
  };
  const archiveControl =
    captain?.kind === "chorus" ? (
      <View className="gap-2 border-t border-border-subtle px-4 py-4">
        <Text className="text-xs text-foreground-muted">
          {archived
            ? gt("Restoring checks every reachable linked machine for another active Chorus.")
            : gt("Archiving removes this Chorus from the fleet. You can restore it later.")}
        </Text>
        {archiveError !== null ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
            {archiveError}
          </Text>
        ) : null}
        <Button
          label={archived ? gt("Restore Chorus") : gt("Archive Chorus")}
          tone={archived ? "primary" : "secondary"}
          loading={archivePending}
          disabled={archived ? !canRestore : !canArchive}
          onPress={() => void changeArchive()}
        />
      </View>
    ) : null;
  const markdown = (text: string) => (
    <SelectableMarkdownText markdown={text} textStyle={markdownStyle} />
  );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader
        title={
          isDuet
            ? gt("Brief", { $context: "noun, what a Duet knows" })
            : (captain?.name ?? gt("Brief", { $context: "noun, what a Duet knows" }))
        }
        subtitle={
          captain && !isDuet ? gt("Brief", { $context: "noun, what a Duet knows" }) : undefined
        }
        onClose={() => navigation.goBack()}
      />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {captain === undefined ? (
            <Text className="px-5 py-8 text-center text-sm text-foreground-muted">
              {unavailable ?? gt("Loading the brief…")}
            </Text>
          ) : isDuet ? (
            <DuetBriefBody
              environmentId={environmentId}
              captain={captain}
              digest={digestNew === "" ? null : markdown(digestNew)}
              notes={notes === "" ? null : markdown(notes)}
              memories={memories}
            />
          ) : (
            <>
              <View className="flex-row items-center gap-3 px-4 pb-4 pt-2">
                <CaptainOrb captain={captain} size={44} />
                <View className="min-w-0 flex-1">
                  <Text className="font-t3-medium text-lg text-foreground" numberOfLines={1}>
                    {captain.name}
                  </Text>
                  {captain.role.trim() ? (
                    <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                      {captain.role}
                    </Text>
                  ) : null}
                </View>
              </View>
              <BriefSection title={gt("New in the digest")}>
                {digestNew === "" ? (
                  <Text className="text-sm text-foreground-muted">{gt("Nothing new yet.")}</Text>
                ) : (
                  markdown(digestNew)
                )}
              </BriefSection>
              <BriefSection title={gt("Notes")}>
                {notes === "" ? (
                  <Text className="text-sm text-foreground-muted">{gt("No notes yet.")}</Text>
                ) : (
                  markdown(notes)
                )}
              </BriefSection>
              <BriefSection title={gt("Always remembers")}>
                {memories.length === 0 ? (
                  <Text className="text-sm text-foreground-muted">
                    {gt("No essential memories yet.")}
                  </Text>
                ) : (
                  memories.map((memory) => (
                    <Text key={memory.id} className="text-sm text-foreground">
                      {`• ${memory.text}`}
                    </Text>
                  ))
                )}
              </BriefSection>
            </>
          )}
          {archiveControl}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainBriefItems,
  captainBriefVisible,
  captainDigestNewSection,
  captainDigestRest,
} from "@t3tools/client-runtime/state/captain-digest";
import { captainDocument } from "@t3tools/client-runtime/state/captains";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, ScheduledTaskId } from "@t3tools/contracts";
import { resolveBriefModelSelection } from "@t3tools/shared/serverSettings";
import { parseThreadLinkHref, threadLinkCandidates } from "@t3tools/shared/threadLinks";
import { useGT, useLocale } from "gt-react-native";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { tryOpenWebLink } from "../../lib/openExternalUrl";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useEnvironmentServerConfig, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { useOpenThreadLink } from "../threads/useOpenThreadLink";
import { DuetCreature } from "./DuetCreature";
import type { CaptainOverviewRow } from "./captainOverview";

function RecapSchedule({ row }: { readonly row: CaptainOverviewRow }) {
  const gt = useGT();
  const {
    captain,
    environment: { environmentId },
  } = row;
  const id = ScheduledTaskId.make(`captain-morning-brief:${captain.id}`);
  const settings = useEnvironmentServerConfig(environmentId)?.settings;
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, captain.primaryThreadId));
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const task = tasks.data?.tasks.find((entry) => entry.id === id);
  const canSave = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const [time, setTime] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const schedule = task?.schedule.type === "fixed_time" ? task.schedule : null;
  const shownTime = time ?? schedule?.timeOfDay ?? (captain.kind === "chorus" ? "08:15" : "08:00");
  const shownEnabled = enabled ?? task?.enabled ?? false;
  const editable = canSave && thread !== null && tasks.data !== null && tasks.error === null;
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(shownTime);
  const save = async () => {
    if (thread === null || !editable || !validTime || pending !== null) return;
    setPending("save");
    setError(null);
    const result = await upsert({
      environmentId,
      input: {
        id,
        title: gt("Recap for {name}", { name: captain.name }),
        prompt: "Generate the recap.",
        enabled: shownEnabled,
        schedule: {
          type: "fixed_time",
          timeOfDay: shownTime,
          ...(schedule?.weekdays === undefined ? {} : { weekdays: schedule.weekdays }),
        },
        projectId: thread.projectId,
        threadId: captain.primaryThreadId,
        threadMode: "continue",
        workspaceStrategy: { type: "root" },
        kind: "captain_morning_brief",
        modelSelection: settings ? resolveBriefModelSelection(settings) : thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        creationSource: "mobile",
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Could not save the recap."));
    }
  };
  const run = async () => {
    if (task === undefined || !canRun || pending !== null) return;
    setPending("run");
    setError(null);
    const result = await runNow({ environmentId, input: { id } });
    setPending(null);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Could not run the recap."));
    }
  };
  if (tasks.error !== null || tasks.data === null) {
    return (
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm text-foreground-muted">{tasks.error ?? gt("Loading tasks…")}</Text>
        {tasks.error === null ? null : (
          <Button label={gt("Retry")} tone="text" onPress={tasks.refresh} />
        )}
      </View>
    );
  }
  const shownError = error ?? (task?.lastRunStatus === "failed" ? task.lastRunError : null);
  return (
    <View className="gap-2 rounded-xl border border-border-subtle p-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 font-t3-medium text-sm text-foreground">
          {gt("Enable recap")}
        </Text>
        <Switch
          accessibilityLabel={gt("Enable recap")}
          value={shownEnabled}
          disabled={!editable || pending !== null}
          onValueChange={setEnabled}
        />
      </View>
      <View className="flex-row items-center gap-3">
        <Text className="min-w-0 flex-1 text-sm text-foreground-muted">{gt("Recap time")}</Text>
        <TextInput
          accessibilityLabel={gt("Recap time")}
          className="min-h-11 min-w-20 rounded-lg bg-subtle px-3 text-foreground"
          value={shownTime}
          editable={editable && pending === null}
          autoCorrect={false}
          maxLength={5}
          onChangeText={setTime}
        />
      </View>
      {validTime ? null : (
        <Text className="text-xs text-danger-foreground">
          {gt("Enter a time in HH:MM format.")}
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {editable ? (
          <Button
            label={gt("Save")}
            disabled={!validTime || pending !== null || (time === null && enabled === null)}
            loading={pending === "save"}
            onPress={() => void save()}
          />
        ) : null}
        {task === undefined ? null : (
          <Button
            label={gt("Run now")}
            disabled={!canRun || pending !== null}
            loading={pending === "run"}
            onPress={() => void run()}
          />
        )}
      </View>
      {shownError === null ? null : (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {shownError}
        </Text>
      )}
    </View>
  );
}

export function CaptainOverviewRecap(props: {
  readonly row: CaptainOverviewRow;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const { row } = props;
  const {
    captain,
    environment: { environmentId },
  } = row;
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const live = useEnvironmentQuery(
    canRead
      ? serverEnvironment.captainsLive({ environmentId, input: { captainId: captain.id } })
      : null,
  );
  const [expanded, setExpanded] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const markdownStyle = useMarkdownPreviewStyles().nativeTextStyle;
  const digest = captainDocument(live.data, captain.id, "DIGEST.md");
  const content = digest?.content.trim() ?? "";
  const fresh = captainDigestNewSection(content);
  const rest = captainDigestRest(content);
  const entries = captainBriefItems(fresh ?? content, { boldLabels: captain.kind === "chorus" });
  const { visible, collapsible, hiddenCount } = captainBriefVisible(entries, expanded);
  const canSchedule = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const openThreadLink = useOpenThreadLink(environmentId);
  const markdown = (text: string) => (
    <SelectableMarkdownText
      markdown={text}
      textStyle={markdownStyle}
      onLinkPress={(href) => {
        const link = parseThreadLinkHref(href);
        const target = link === null ? undefined : threadLinkCandidates(link, environmentId)[0];
        if (target) openThreadLink(target);
        else void tryOpenWebLink(href, "markdown-link");
      }}
    />
  );

  return (
    <View className="my-1.5 gap-2 rounded-2xl border border-border-subtle bg-grouped-card px-3.5 py-2.5">
      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityHint={gt("Opens the Duet conversation")}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
          onPress={props.onOpen}
        >
          <DuetCreature captain={captain} size={27} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-t3-medium text-base text-foreground">
              {captain.name}
            </Text>
            {digest === undefined ? null : (
              <Text className="text-xs text-foreground-muted">
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(digest.updatedAt))}
              </Text>
            )}
          </View>
        </Pressable>
        {canRead ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Refresh recap for {name}", { name: captain.name })}
            accessibilityState={{ busy: live.isPending }}
            disabled={live.isPending}
            onPress={live.refresh}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle"
          >
            <SymbolView name="arrow.clockwise" size={17} tintColorClassName="accent-icon-muted" />
          </Pressable>
        ) : null}
      </View>
      {live.error === null && live.data !== null && content !== "" && fresh !== "" ? (
        markdown(
          visible
            .flatMap((entry) =>
              entry.kind === "label"
                ? [`### ${entry.text}`]
                : [entry.markdown, ...entry.references],
            )
            .join("\n\n"),
        )
      ) : (
        <Text className="text-sm text-foreground-muted">
          {!canRead
            ? gt("You cannot read Duets in this environment.")
            : live.error !== null
              ? gt("The recap could not be loaded.")
              : live.data === null
                ? gt("Loading the recap…")
                : content === ""
                  ? gt("No recap yet")
                  : gt("Nothing new since the last recap.")}
        </Text>
      )}
      {live.error !== null || live.data === null ? null : (
        <View className="flex-row flex-wrap items-center gap-1">
          {collapsible ? (
            <Button
              tone="text"
              size="compact"
              label={expanded ? gt("Show fewer") : gt("Show {count} more", { count: hiddenCount })}
              onPress={() => setExpanded((open) => !open)}
            />
          ) : null}
          {rest === "" ? null : (
            <Button
              tone="text"
              size="compact"
              label={restOpen ? gt("Hide the rest of the digest") : gt("Rest of the digest")}
              onPress={() => setRestOpen((open) => !open)}
            />
          )}
          {canSchedule || canRun ? (
            <Button
              tone="text"
              size="compact"
              label={scheduleOpen ? gt("Hide recap schedule") : gt("Recap schedule")}
              onPress={() => setScheduleOpen((open) => !open)}
            />
          ) : null}
        </View>
      )}
      {restOpen && rest !== "" && live.error === null ? markdown(rest) : null}
      {scheduleOpen && (canSchedule || canRun) ? <RecapSchedule row={row} /> : null}
    </View>
  );
}

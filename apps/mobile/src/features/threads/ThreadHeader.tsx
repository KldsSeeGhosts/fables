import { useGT, useMessages } from "gt-react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";

import { duetOverflowMenu } from "../captains/duetConversationMenu";
import { useCaptainHeaderActions } from "../captains/useCaptainHeaderActions";
import { useDuetCrewOf } from "../captains/useDuetCrewOf";
import { useDuetShell } from "../captains/useDuetShell";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  /** A Captain's conversation adds its Brief and Tasks. */
  readonly thread?: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const captainActions = useCaptainHeaderActions(props.thread ?? null);
  const fileActions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  const isDuet = useDuetShell();
  const navigation = useNavigation();
  const serverConfig = useEnvironmentServerConfig(props.thread?.environmentId ?? null);
  const environmentLabel =
    useEnvironments().environments.find(
      (environment) => environment.environmentId === props.thread?.environmentId,
    )?.label ?? null;
  // A Duet conversation's tools share one ⋯ menu after Tasks and Brief, as the design groups them.
  const duetConversation = isDuet && captainActions.length > 0 && props.thread !== undefined;
  const thread = props.thread;
  const actions = duetConversation ? captainActions : [...captainActions, ...fileActions];
  const menus = duetConversation
    ? [
        duetOverflowMenu(
          {
            environmentLabel,
            terminal: terminalMenu,
            onOpenBrowser:
              thread && serverConfig?.environment.capabilities.serverBrowser === true
                ? () =>
                    navigation.navigate("ThreadBrowserPreview", {
                      environmentId: thread.environmentId,
                      threadId: thread.threadId,
                    })
                : null,
            diff:
              gitMenu?.items.find((item) => item.id === "git-review" && "onPress" in item) ?? null,
            files:
              fileActions[0] === undefined
                ? null
                : {
                    id: "files",
                    title: fileActions[0].accessibilityLabel,
                    icon: "folder",
                    disabled: fileActions[0].disabled,
                    onPress: fileActions[0].onPress,
                  },
          },
          m,
        ),
      ]
    : [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  const crewOf = useDuetCrewOf(props.thread ?? null);
  const crewLabel = crewOf ? gt("Solo for {name}", { name: crewOf.name }) : null;
  return (
    <AppBar
      title={props.title}
      subtitle={
        crewLabel === null
          ? props.subtitle
          : [crewLabel, props.subtitle].filter(Boolean).join(" · ")
      }
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}

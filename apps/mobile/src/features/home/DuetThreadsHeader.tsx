import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { useDuetTokens } from "../captains/useDuetTokens";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

const on = (selected: boolean) => (selected ? ("on" as const) : ("off" as const));

/**
 * The Duet shell's Threads heading. Its filter icon holds the environment and project filters
 * that other themes show as pills above the list.
 */
export function DuetThreadsHeader(props: {
  readonly filter: {
    readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
    readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
    readonly selectedEnvironmentId: EnvironmentId | null;
    readonly selectedProjectKey: string | null;
    readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
    readonly onProjectChange: (projectKey: string | null) => void;
  } | null;
}) {
  const gt = useGT();
  const tokens = useDuetTokens();
  const { filter } = props;
  const filtered =
    filter !== null &&
    (filter.selectedEnvironmentId !== null || filter.selectedProjectKey !== null);
  const select = (id: string) => {
    if (filter === null) return;
    if (id === "reset") {
      filter.onEnvironmentChange(null);
      filter.onProjectChange(null);
    } else if (id === "environment:all") filter.onEnvironmentChange(null);
    else if (id === "project:all") filter.onProjectChange(null);
    else if (id.startsWith("environment:")) {
      const environment = filter.environments[Number(id.slice("environment:".length))];
      if (environment) filter.onEnvironmentChange(environment.environmentId);
    } else if (id.startsWith("project:")) {
      const project = filter.projects[Number(id.slice("project:".length))];
      if (project) filter.onProjectChange(project.key);
    }
  };
  return (
    <View className="mt-2 h-11 flex-row items-center gap-1.5 pl-4 pr-1.5">
      <Text className="min-w-0 flex-1 font-t3-medium" style={{ fontSize: 13, color: tokens.muted }}>
        {gt("Threads", { $context: "screen title, list of chat threads" })}
      </Text>
      {filter === null ? null : (
        <Menu
          title={gt("Filter threads")}
          actions={[
            {
              id: "environment",
              title: gt("Environment", { $context: "filter menu heading" }),
              subactions: [
                {
                  id: "environment:all",
                  title: gt("All environments"),
                  state: on(filter.selectedEnvironmentId === null),
                },
                ...filter.environments.map((environment, index) => ({
                  id: `environment:${index}`,
                  title: environment.label,
                  state: on(environment.environmentId === filter.selectedEnvironmentId),
                })),
              ],
            },
            {
              id: "project",
              title: gt("Project", { $context: "filter menu heading" }),
              subactions: [
                {
                  id: "project:all",
                  title: gt("All projects"),
                  state: on(filter.selectedProjectKey === null),
                },
                ...filter.projects.map((project, index) => ({
                  id: `project:${index}`,
                  title: project.label,
                  state: on(project.key === filter.selectedProjectKey),
                })),
              ],
            },
            ...(filtered ? [{ id: "reset", title: gt("Reset thread filters") }] : []),
          ]}
          onPressAction={({ nativeEvent }) => select(nativeEvent.event)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Filter threads")}
            accessibilityState={{ selected: filtered }}
            className="h-11 w-11 items-center justify-center rounded-[10px]"
          >
            <SymbolView
              name={
                filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease"
              }
              size={18}
              tintColor={filtered ? tokens.foreground : tokens.icon}
            />
          </Pressable>
        </Menu>
      )}
    </View>
  );
}

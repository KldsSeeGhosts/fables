import { useGT } from "gt-react-native";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

export interface ThreadFeedHistoryControls {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onLoadEarlier: () => void;
  /** Loads earlier history down to the entry, in one request. */
  readonly onLoadThrough: (entryId: string) => void;
  readonly label?: string;
  readonly loadingLabel?: string;
}

export function ThreadFeedPlaceholder(props: {
  readonly bottomInset: number;
  readonly detail: string;
  readonly horizontalPadding: number;
  readonly title: string;
  readonly topInset: number;
  readonly historyControls?: ThreadFeedHistoryControls | undefined;
}) {
  return (
    <View
      pointerEvents={props.historyControls ? "box-none" : undefined}
      style={{
        flex: 1,
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: props.topInset,
        paddingBottom: props.bottomInset,
        paddingHorizontal: props.horizontalPadding + 24,
      }}
    >
      {props.historyControls ? <ThreadFeedLoadEarlierControl {...props.historyControls} /> : null}
      <View pointerEvents="none" className="max-w-[320px] items-center gap-2">
        <Text className="text-center font-t3-bold text-lg text-foreground">{props.title}</Text>
        <Text className="text-center text-sm leading-normal text-foreground-secondary">
          {props.detail}
        </Text>
      </View>
    </View>
  );
}

export function ThreadFeedLoadEarlierControl(props: ThreadFeedHistoryControls) {
  const gt = useGT();
  if (!props.hasMoreHistory && props.error === null) {
    return null;
  }
  return (
    <View className="mb-3 items-center gap-1.5 px-2">
      {props.hasMoreHistory ? (
        <View className="self-center">
          <Button
            label={
              props.loading
                ? (props.loadingLabel ?? gt("Loading earlier activity…"))
                : (props.label ?? gt("Load earlier activity"))
            }
            tone="secondary"
            accessibilityLabel={props.label ?? gt("Load earlier activity")}
            disabled={props.loading}
            onPress={props.onLoadEarlier}
            icon="chevron.up"
            loading={props.loading}
          />
        </View>
      ) : null}
      {props.error !== null ? (
        <Text className="text-center text-xs text-icon-subtle">{props.error}</Text>
      ) : null}
    </View>
  );
}

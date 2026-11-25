import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useLayoutPane } from "../../layout/layoutPaneContext";
import { useLayoutStore } from "../../layout/layoutStore";
import { followLayoutCompanions } from "../../layout/openRules";
import { findThreadChat } from "../../layout/surfaceSync";
import { buildThreadRouteParams } from "../../threadRoutes";

/**
 * Opens a Captain's thread in a split beside the Captains page, or focuses its open chat. Outside
 * a layout pane it navigates to the thread instead.
 */
export function useOpenCaptainThread() {
  const navigate = useNavigate();
  const { paneId } = useLayoutPane();
  return (threadRef: ScopedThreadRef) => {
    if (paneId !== null) {
      followLayoutCompanions(() => {
        const store = useLayoutStore.getState();
        const chat = findThreadChat(store.layout, threadRef);
        if (chat) store.focusTab(chat.tab.id);
        else
          store.placeContent(
            { kind: "chat", target: { kind: "server", threadRef } },
            { kind: "split", paneId, side: "right" },
          );
      });
    }
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  };
}

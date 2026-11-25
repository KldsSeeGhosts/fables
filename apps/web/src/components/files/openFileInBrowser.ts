import type { EditorId, EnvironmentId } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";

import { isBrowserPreviewFile } from "~/browser/openFileInPreview";
import { toastManager } from "~/components/ui/toast";
import type { RemoteOpenResolution } from "~/remoteOpen";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

export function canOpenFileInBrowserLocally(input: {
  readonly filePath: string | null;
  readonly remoteOpen: RemoteOpenResolution;
  readonly availableEditors: ReadonlyArray<EditorId>;
}): boolean {
  return (
    input.filePath !== null &&
    isBrowserPreviewFile(input.filePath) &&
    input.remoteOpen.isResolved &&
    input.remoteOpen.state.mode === "local-exec" &&
    input.availableEditors.includes("file-manager")
  );
}

export function useOpenFileInBrowser(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const resolve = useMessages();

  return async (absolutePath: string): Promise<boolean> => {
    if (environmentId === null) return false;
    const result = await openInEditor({
      environmentId,
      input: { cwd: absolutePath, editor: "file-manager" },
    });
    if (result._tag !== "Failure") return true;
    toastManager.add({
      type: "error",
      title: resolve(msg("Could not open file in browser")),
      description: absolutePath,
    });
    return false;
  };
}

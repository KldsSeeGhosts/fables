import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { Captain, EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { CompassIcon } from "lucide-react";
import { useState } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { SettingsPaneHeader, SettingsTabNotch } from "../settings/SettingsTabNotch";
import { SidebarInset } from "../ui/sidebar";
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { CaptainsInbox } from "./CaptainsInbox";
import { useCaptainDestinations, useCaptainsDirectory } from "./captainsDirectory";
import { useOpenCaptainThread } from "./captainNavigation";

/** The Captains home: what every Captain has waiting, running and finished, in one column. */
export function CaptainsWorkspace() {
  const gt = useGT();
  const isDuet = useDuetShell();
  const { environments, shells } = useCaptainsDirectory();
  const { destinations, destination } = useCaptainDestinations(usePrimaryEnvironmentId());
  const [creating, setCreating] = useState(false);
  const openThread = useOpenCaptainThread();
  const openCaptain = (environmentId: EnvironmentId, captain: Captain) =>
    openThread(scopeThreadRef(environmentId, captain.primaryThreadId));

  return (
    <SidebarInset
      variant="pane"
      className="h-full min-h-0 overflow-hidden"
      {...workspaceAreaProps("captains", 20)}
    >
      <div className="pane-mobile-chrome flex min-h-0 min-w-0 flex-1 flex-col">
        <SettingsPaneHeader transparent>
          <SettingsTabNotch
            title={isDuet ? gt("Duets") : gt("Captains")}
            icon={<CompassIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />}
          >
            <h1 className="truncate">{isDuet ? <T>Duets</T> : <T>Captains</T>}</h1>
          </SettingsTabNotch>
        </SettingsPaneHeader>
        <div className="@container/duets-page scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto">
          <CaptainsInbox
            environments={environments}
            shells={shells}
            onOpenThread={openThread}
            onOpenCaptain={openCaptain}
            onCreate={destination ? () => setCreating(true) : undefined}
          />
        </div>
      </div>
      {creating && destination ? (
        <CaptainEditorDialog
          destination={destination}
          destinations={destinations}
          onClose={() => setCreating(false)}
          onSave={(environmentId, captain) => {
            setCreating(false);
            openCaptain(environmentId, captain);
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

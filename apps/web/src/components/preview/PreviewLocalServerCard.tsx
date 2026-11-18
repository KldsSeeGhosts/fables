import { ArrowUpRight } from "lucide-react";
import { msg, T, useMessages } from "gt-react";

import { Button } from "~/components/ui/button";

import type { MessageResolver } from "../../i18n/messages";

import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  server: PreviewableServer;
  onOpen: () => void;
}

/** One live local server: a live dot, its address, the owning process, and Open. */
export function PreviewLocalServerCard({ server, onOpen }: Props) {
  const m = useMessages();
  const address = `${server.host}:${server.port}`;
  return (
    <div className="flex items-center gap-2.5 rounded-card surface-card-settings px-3 py-2.5">
      <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-success" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-body text-foreground">{address}</span>
        <span className="truncate text-caption text-dim-foreground">
          {describeServer(server, m)}
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="xs"
        aria-label={m(msg("Open {address}", { address }))}
        onClick={onOpen}
      >
        <ArrowUpRight />
        <T>Open</T>
      </Button>
    </div>
  );
}

function describeServer(server: PreviewableServer, resolve: MessageResolver): string {
  if (server.processName) return server.processName;
  return resolve(msg("Listening", { $context: "a local server is listening on a port" }));
}

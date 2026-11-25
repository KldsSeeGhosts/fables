/* oxlint-disable shadcn/no-arbitrary-values, t3code/no-raw-type-classes, t3code/no-dot-separated-text -- the V3 Duet document-card spec fixes exact type sizes and tile colors. */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { FileText } from "lucide-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { Button } from "../ui/button";
import type { DuetDocumentReference } from "./duetStream.logic";

function filePanelPath(href: string, workspaceRoot: string | undefined): string {
  const withoutProtocol = href.replace(/^file:\/\//, "");
  const path = withoutProtocol.replaceAll("\\", "/");
  const root = workspaceRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
  if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path.replace(/^\/+/, "");
}

/** A standalone document reference in a Captain channel reply. */
export function DuetDocumentCard({
  document,
  captainRef: _captainRef,
  threadRef,
  workspaceRoot,
}: {
  readonly document: DuetDocumentReference;
  readonly captainRef: ScopedThreadRef | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const gt = useGT();
  const open = () => {
    if (document.href !== null && threadRef !== null) {
      useRightPanelStore
        .getState()
        .openFile(threadRef, filePanelPath(document.href, workspaceRoot));
    }
  };
  return (
    <div className="flex w-[366px] max-w-full items-center gap-3 rounded-xl border border-(--duet-hairline) bg-background p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f5] text-muted-foreground dark:bg-[#2a2a2a]">
        <FileText aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 text-foreground">
          {document.title}
        </span>
        <span className="block text-[12px] leading-4 text-muted-foreground">
          {gt("Document · {extension}", { extension: document.extension.toUpperCase() })}
        </span>
      </span>
      <Button
        variant="secondary"
        size="xs"
        aria-label={gt("Open {title}", { title: document.title })}
        onClick={open}
      >
        {document.action === "download" ? gt("Download") : gt("Open")}
      </Button>
    </div>
  );
}

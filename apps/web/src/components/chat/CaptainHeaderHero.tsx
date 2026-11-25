/* oxlint-disable t3code/no-styled-raw-controls -- The Duet hero orb and title menu are bespoke header controls outside shared button variants. */
import "./DuetHeaderChrome.css";

import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  MessageSquarePlusIcon,
  PaletteIcon,
  PencilIcon,
  Settings2Icon,
  StickyNoteIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";

import { CaptainAvatar, type CaptainAvatarState } from "../captains/CaptainAvatar";
import { useCaptainAvatarLabels } from "../captains/captainAvatarLabels";
import { CaptainProfileDialogs, useCaptainProfile } from "../captains/CaptainBriefPanel";
import { captainBriefTabAtom, openCaptainTasks } from "../captains/captainBriefTab";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_EMBLEM_ORDER,
  DUET_PALETTE_ORDER,
  DUET_PICKER,
} from "../captains/captainPalette";
import { CaptainResetDialog } from "../captains/CaptainResetButton";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { DuetStatusPopover, useDuetThreadStatus } from "./DuetThreadStatus";

function avatarStateFor(archived: boolean, statusState: string): CaptainAvatarState {
  if (archived) return "archived";
  if (statusState === "working") return "working";
  if (statusState === "waiting") return "waiting";
  return "idle";
}

/**
 * A Duet channel's top-left title and customization menu, aligned next to the sidebar border.
 */
export function CaptainHeaderTitleMenu({
  captain,
  threadRef,
  layoutTabId,
  onOpenThread,
  onPointerDown,
  onAuxClick,
  onContextMenu,
}: {
  captain: Captain;
  threadRef: ScopedThreadRef;
  layoutTabId: string | null | undefined;
  onOpenThread: (threadId: ThreadId) => void;
  onPointerDown?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  onAuxClick?: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const gt = useGT();
  const status = useDuetThreadStatus(threadRef);
  const profile = useCaptainProfile({
    captain,
    environmentId: threadRef.environmentId,
    onDelete: () => {},
  });
  const labels = useCaptainAvatarLabels();
  const [renaming, setRenaming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const renameSettledRef = useRef(false);
  const { current, archived, pending, canUpdate } = profile;
  const avatarState = avatarStateFor(archived, status.state);
  const emblem = captainEmblemOf(current.avatar);
  const palette = captainPaletteOf(current.avatar);

  const changeAvatar = async (avatar: Captain["avatar"]) => {
    const error = await profile.save({ avatar });
    if (error !== null) toastManager.add({ type: "error", title: error });
  };
  const openInstructions = () => {
    appAtomRegistry.set(captainBriefTabAtom(threadRef), "docs");
    openCaptainTasks(threadRef, "docs");
  };
  const commitRename = async (value: string) => {
    renameSettledRef.current = true;
    setRenaming(false);
    const name = value.trim();
    if (name === "" || name === current.name) return;
    const error = await profile.save({ name });
    if (error !== null) toastManager.add({ type: "error", title: error });
  };
  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") void commitRename(event.currentTarget.value);
    else if (event.key === "Escape") {
      event.preventDefault();
      renameSettledRef.current = true;
      setRenaming(false);
    }
  };
  const handleRenameBlur = (event: ReactFocusEvent<HTMLInputElement>) => {
    if (!renameSettledRef.current) void commitRename(event.currentTarget.value);
  };

  return (
    <div
      className="flex min-w-0 items-center ps-3 [-webkit-app-region:no-drag]"
      onContextMenu={onContextMenu}
    >
      {renaming ? (
        <div
          className="flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 inset-ring inset-ring-ring/50 focus-within:inset-ring-ring"
          data-captain-hero-name=""
        >
          <CaptainAvatar avatar={current.avatar} size="row" state={avatarState} />
          <input
            autoFocus
            dir="auto"
            aria-label={gt("Duet name")}
            maxLength={80}
            defaultValue={current.name}
            className="min-w-20 max-w-full bg-transparent text-body text-foreground outline-none [field-sizing:content]"
            onFocus={(event) => {
              renameSettledRef.current = false;
              event.currentTarget.select();
            }}
            onBlur={handleRenameBlur}
            onKeyDown={handleRenameKeyDown}
          />
        </div>
      ) : (
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                data-layout-pane-tab={layoutTabId ?? undefined}
                data-captain-hero-name=""
                aria-label={gt("Duet menu for {name}", { name: current.name })}
                onPointerDown={onPointerDown}
                onAuxClick={onAuxClick}
                className="flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md ps-2 pe-1.5 text-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <CaptainAvatar avatar={current.avatar} size="row" state={avatarState} />
            <span className="min-w-0 truncate" dir={textDirection(current.name)}>
              {current.name}
            </span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="start" width="wide">
            <MenuItem disabled={!canUpdate} onClick={profile.edit}>
              <Settings2Icon aria-hidden />
              <T>Customize Duet</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!canUpdate || pending} onClick={() => setRenaming(true)}>
              <PencilIcon aria-hidden />
              <T>Rename</T>
            </MenuItem>
            <MenuItem onClick={openInstructions}>
              <StickyNoteIcon aria-hidden />
              <T>Instructions</T>
            </MenuItem>
            <MenuSub>
              <MenuSubTrigger disabled={!canUpdate || pending}>
                <PaletteIcon aria-hidden />
                <T>Change icon</T>
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuGroup>
                  <MenuGroupLabel>
                    <T>Creature</T>
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={emblem}
                    onValueChange={(value) => {
                      const next = DUET_EMBLEM_ORDER.find((entry) => entry === value);
                      if (next && next !== emblem)
                        void changeAvatar({
                          preset: DUET_PICKER.emblems[next],
                          color: DUET_PICKER.palettes[palette],
                        });
                    }}
                  >
                    {DUET_EMBLEM_ORDER.map((entry) => (
                      <MenuRadioItem key={entry} value={entry} closeOnClick>
                        <CaptainAvatar
                          avatar={{
                            preset: DUET_PICKER.emblems[entry],
                            color: DUET_PICKER.palettes[palette],
                          }}
                          size="row"
                        />
                        <span className="min-w-0 truncate">{labels.emblems[entry]}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>
                    <T>Color</T>
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={palette}
                    onValueChange={(value) => {
                      const next = DUET_PALETTE_ORDER.find((entry) => entry === value);
                      if (next && next !== palette)
                        void changeAvatar({
                          preset: DUET_PICKER.emblems[emblem],
                          color: DUET_PICKER.palettes[next],
                        });
                    }}
                  >
                    {DUET_PALETTE_ORDER.map((entry) => (
                      <MenuRadioItem key={entry} value={entry} closeOnClick>
                        <CaptainAvatar
                          avatar={{
                            preset: DUET_PICKER.emblems[emblem],
                            color: DUET_PICKER.palettes[entry],
                          }}
                          size="row"
                        />
                        <span className="min-w-0 truncate">{labels.palettes[entry]}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuSubPopup>
            </MenuSub>
            <MenuItem disabled={archived} onClick={() => setResetting(true)}>
              <MessageSquarePlusIcon aria-hidden />
              <T>New conversation</T>
            </MenuItem>
            <MenuItem
              disabled={pending || !profile.canArchive}
              onClick={() => void profile.changeArchive()}
            >
              {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />}
              {archived ? <T>Restore</T> : <T>Archive</T>}
            </MenuItem>
            {profile.canDelete ? (
              <>
                <MenuSeparator />
                <MenuItem variant="destructive" disabled={pending} onClick={profile.requestDelete}>
                  <Trash2Icon aria-hidden />
                  <T>Delete</T>
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      )}
      <CaptainProfileDialogs profile={profile} />
      {resetting ? (
        <CaptainResetDialog
          captain={current}
          environmentId={threadRef.environmentId}
          onClose={() => setResetting(false)}
          onReset={onOpenThread}
        />
      ) : null}
    </div>
  );
}

/**
 * A Duet channel's centred orb and ever-updating live status indicator.
 */
export function CaptainHeaderHero({
  captain,
  threadRef,
  onContextMenu,
}: {
  captain: Captain;
  threadRef: ScopedThreadRef;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const gt = useGT();
  const status = useDuetThreadStatus(threadRef);
  const avatarState = avatarStateFor(captain.archivedAt !== null, status.state);

  const orb = (
    <button
      type="button"
      aria-label={gt("Status: {status}", { status: status.stateText })}
      data-captain-hero-orb=""
      className="flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <CaptainAvatar avatar={captain.avatar} size="orb" state={avatarState} />
    </button>
  );

  return (
    <div
      data-captain-header-hero=""
      className="pointer-events-none absolute inset-y-0 left-1/2 z-20 flex -translate-x-1/2 items-center"
    >
      <div
        className="pointer-events-auto relative flex items-center [-webkit-app-region:no-drag]"
        onContextMenu={onContextMenu}
      >
        <DuetStatusPopover
          threadRef={threadRef}
          status={status}
          mark={<CaptainAvatar avatar={captain.avatar} size="orb" state={avatarState} />}
          trigger={orb}
        />
        {status.state !== "idle" ? (
          <span
            data-captain-hero-live={status.state}
            className={cn(
              "pointer-events-none absolute top-full left-1/2 mt-0.5 flex h-6 max-w-72 -translate-x-1/2 items-center gap-1.5 rounded-full border border-(--duet-hairline,var(--border)) bg-background px-2.5 text-caption whitespace-nowrap shadow-xs",
              status.state === "working"
                ? "text-(--duet-working-text,var(--foreground))"
                : status.state === "waiting"
                  ? "text-(--duet-needs-input-text,var(--warning-foreground))"
                  : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status.state === "working"
                  ? "bg-(--duet-working,var(--info))"
                  : status.state === "waiting"
                    ? "bg-(--duet-needs-input-ring,var(--warning))"
                    : "bg-muted-foreground",
              )}
            />
            <span className="min-w-0 truncate">{status.liveLabel}</span>
          </span>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {status.liveLabel}
        </span>
      </div>
    </div>
  );
}

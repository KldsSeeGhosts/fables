/* oxlint-disable t3code/no-styled-raw-controls -- The Duet hero orb and title menu are bespoke header controls outside shared button variants. */
import "./DuetHeaderChrome.css";

import { useAtomValue } from "@effect/atom-react";
import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  Columns2Icon,
  CopyXIcon,
  Layers2Icon,
  LinkIcon,
  MaximizeIcon,
  MessageSquarePlusIcon,
  PaletteIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PencilIcon,
  PinIcon,
  Settings2Icon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildLayoutTabMenuItems,
  isLayoutTabMenuId,
  runLayoutTabMenuAction,
} from "../../layout/PaneTabs";
import { useLayoutStore } from "../../layout/layoutStore";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { duetTabHasNeighbor } from "./PanelLayoutControls";
import { textDirection } from "~/textDirection";

import { CaptainAvatar, type CaptainAvatarState } from "../captains/CaptainAvatar";
import { useCaptainAvatarLabels } from "../captains/captainAvatarLabels";
import { CaptainProfileDialogs, useCaptainProfile } from "../captains/CaptainBriefPanel";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_EMBLEM_ORDER,
  DUET_PALETTE_ORDER,
  DUET_PICKER,
} from "../captains/captainPalette";
import { CaptainResetDialog } from "../captains/CaptainResetButton";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuShortcut,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { useDuetThreadStatus } from "./DuetThreadStatus";
import type { DuetOrbState } from "./duetStatus.logic";

const LAYOUT_MENU_ICONS: Record<string, LucideIcon> = {
  pin: PinIcon,
  "panel-right": PanelRightIcon,
  "panel-bottom": PanelBottomIcon,
  "columns-2": Columns2Icon,
  "layers-2": Layers2Icon,
  maximize: MaximizeIcon,
  link: LinkIcon,
  x: XIcon,
  "copy-x": CopyXIcon,
};

function LayoutMenuItem({
  item,
  onAction,
}: {
  item: ReturnType<typeof buildLayoutTabMenuItems>[number];
  onAction: (id: string) => void;
}) {
  const Icon = item.icon === undefined ? null : (LAYOUT_MENU_ICONS[item.icon] ?? null);
  return (
    <>
      {item.separatorBefore ? <MenuSeparator /> : null}
      <MenuItem disabled={item.disabled} onClick={() => onAction(item.id)}>
        {Icon ? <Icon aria-hidden /> : null}
        <MenuItemLabel>{item.label}</MenuItemLabel>
        {item.shortcut ? <MenuShortcut>{item.shortcut}</MenuShortcut> : null}
      </MenuItem>
    </>
  );
}

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
  const navigate = useNavigate();
  const status = useDuetThreadStatus(threadRef);
  const profile = useCaptainProfile({
    captain,
    environmentId: threadRef.environmentId,
    onDelete: () => void navigate({ to: "/captains" }),
  });
  const labels = useCaptainAvatarLabels();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const layout = useLayoutStore((state) => state.layout);
  const maximizedTabId = useLayoutStore((state) => state.maximizedTabId);
  const [renaming, setRenaming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const renameSettledRef = useRef(false);
  const { current, archived, pending, canUpdate } = profile;
  const avatarState = avatarStateFor(archived, status.state);
  const layoutItems =
    layoutTabId == null
      ? []
      : buildLayoutTabMenuItems(layout, layoutTabId, keybindings).filter(
          (item) => item.id !== "layout:close-tab" || duetTabHasNeighbor(layout, layoutTabId),
        );
  const runLayoutAction = (id: string) => {
    if (layoutTabId != null && isLayoutTabMenuId(id)) runLayoutTabMenuAction(id, layoutTabId);
  };
  const emblem = captainEmblemOf(current.avatar);
  const palette = captainPaletteOf(current.avatar);

  const changeAvatar = async (avatar: Captain["avatar"]) => {
    const error = await profile.save({ avatar });
    if (error !== null) toastManager.add({ type: "error", title: error });
  };
  const openMemory = () => profile.edit("memory");
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
          <CaptainAvatar
            avatar={current.avatar}
            size="row"
            state={avatarState}
            activity={status.activity}
            celebrate={status.celebrating}
          />
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
            <CaptainAvatar
              avatar={current.avatar}
              size="row"
              state={avatarState}
              activity={status.activity}
              celebrate={status.celebrating}
            />
            <span className="min-w-0 truncate" dir={textDirection(current.name)}>
              {current.name}
            </span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="start" width="wide">
            {layoutItems.map((item) => (
              <LayoutMenuItem
                key={`${item.id}:${maximizedTabId === layoutTabId}`}
                item={item}
                onAction={runLayoutAction}
              />
            ))}
            {layoutItems.length > 0 ? <MenuSeparator /> : null}
            <MenuItem disabled={!canUpdate} onClick={() => profile.edit()}>
              <Settings2Icon aria-hidden />
              <T>Customize Duet</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!canUpdate || pending} onClick={() => setRenaming(true)}>
              <PencilIcon aria-hidden />
              <T>Rename</T>
            </MenuItem>
            <MenuItem onClick={openMemory}>
              <StickyNoteIcon aria-hidden />
              <T>Memory</T>
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

function CaptainHeroLivePill({
  layer,
  label,
  state,
}: {
  layer: "current" | "outgoing";
  label: string;
  state: DuetOrbState;
}) {
  return (
    <span
      aria-hidden
      data-captain-hero-live={state}
      data-captain-hero-live-label={layer}
      className="absolute top-[calc(100%-10px)] left-1/2 flex h-7 w-max max-w-72 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-(--duet-panel-border,var(--border)) bg-(--duet-panel-fill,var(--background)) px-3 text-body whitespace-nowrap text-foreground shadow-(--duet-panel-shadow,var(--shadow-md))"
    >
      <span className="max-w-64 truncate">{label}</span>
    </span>
  );
}

/** A Duet channel's centred creature and stabilized live status pill. */
export function CaptainHeaderHero({
  captain,
  threadRef,
}: {
  captain: Captain;
  threadRef: ScopedThreadRef;
}) {
  const status = useDuetThreadStatus(threadRef);
  const avatarState = avatarStateFor(captain.archivedAt !== null, status.state);

  return (
    <div data-captain-header-hero="" className="pointer-events-none absolute inset-y-0 z-20">
      <div className="relative flex items-center">
        <CaptainAvatar
          avatar={captain.avatar}
          size="hero"
          state={avatarState}
          activity={status.activity}
          celebrate={status.celebrating}
        />
        {status.liveVisible ? (
          <>
            {status.liveOutgoing ? (
              <CaptainHeroLivePill
                key={`outgoing-${status.liveOutgoing.label}`}
                layer="outgoing"
                label={status.liveOutgoing.label}
                state={status.state}
              />
            ) : null}
            <CaptainHeroLivePill
              key={`current-${status.liveLabel}`}
              layer="current"
              label={status.liveLabel}
              state={status.state}
            />
          </>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {status.liveLabel}
        </span>
      </div>
    </div>
  );
}

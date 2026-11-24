/* oxlint-disable t3code/no-raw-type-classes, shadcn/no-arbitrary-values, shadcn/no-restyle -- Duet chrome uses exact Claude Desktop geometry and colors outside the shared control variants. */
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  EllipsisIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  WorkflowIcon,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import {
  useConnectedEnvironmentIds,
  useIssuesSupported,
  usePullRequestsSupported,
} from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  useSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { TooltipProvider } from "../ui/tooltip";
import { Badge } from "../ui/badge";
import { T3Wordmark } from "../T3Wordmark";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { beginLayoutContentDrag } from "../../layout/layoutDrag";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Button } from "../ui/button";
import { useOpenLayoutPage } from "../../layout/pageNavigation";
import { IssueGlyph } from "../issue/issuePresentation";
import { useWorkflowEnvironmentIds } from "../workflows/useWorkflowEnvironmentIds";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { SidebarUpstreamUpdatePill } from "./SidebarUpstreamUpdatePill";

const SIDEBAR_BRAND_OFFSET = "ml-[var(--workspace-titlebar-content-left)]";

// The pill yields first; the minimum always reserves both history buttons.
export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) =>
    observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className={cn(SIDEBAR_BRAND_OFFSET, "flex gap-2")}>
        <SidebarBrandMark onBackdrop={false} />
        <div className="w-[calc(var(--workspace-titlebar-control-size)*2)]" />
      </div>
    </div>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  const gt = useGT();
  return (
    <Link
      data-app-brand=""
      aria-label={gt("T3 Code home")}
      className={cn(
        "pointer-events-auto relative z-10 hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white light:text-foreground" : "text-foreground",
      )}
      to="/"
    >
      <SidebarBrandMark onBackdrop={onBackdrop} />
    </Link>
  );
}

function SidebarBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-label tracking-tight">
      <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
      <span
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white/70 light:text-muted-foreground" : "text-muted-foreground",
        )}
      >
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        {"Code"}
      </span>
    </span>
  );
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  onNewThread,
  onAddProject,
  onOpenProjectScope,
  onSearch,
}: {
  isElectron: boolean;
  onNewThread?: (() => void) | undefined;
  onAddProject?: (() => void) | undefined;
  onOpenProjectScope?: (() => void) | undefined;
  onSearch?: (() => void) | undefined;
}) {
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = useSidebarStageBackdropVariant(environmentIdentificationMode);
  const gt = useGT();
  const isDuet = useTheme().theme === "ksg-salon";

  return (
    // The sidebar's share of the window chrome row, not a padded SidebarHeader.
    // Fixed controls sit over it; the inset content starts 4px under the row (pen s8qVFu).
    <div
      className={cn(
        "@container/sidebar-header relative flex h-(--workspace-chrome-row-height) shrink-0 flex-row items-center gap-2 pr-3 md:px-0",
        "md:group-data-[variant=inset]:-ms-(--workspace-sidebar-edge-inset) md:group-data-[variant=inset]:mb-[calc(--spacing(1)-var(--sidebar-content-inset))]",
        isElectron && "drag-region",
        isDuet && "h-13 pr-2",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      {/* Match the fixed control's inset inside the sheet's safe area. */}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {isDuet ? (
        <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2 md:pl-[var(--workspace-titlebar-content-left)]">
          <div className="min-w-0 flex-1 truncate font-display text-[19px] font-medium text-[#141413] dark:text-[#ececec] max-md:pl-2">
            {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
            KSG Duet
          </div>
          <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
            <Menu>
              <MenuTrigger
                render={<Button size="icon-sm" variant="ghost" />}
                aria-label={gt("Sidebar actions")}
              >
                <EllipsisIcon className="size-4" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => onNewThread?.()}>
                  <T>New thread</T>
                </MenuItem>
                <MenuItem onClick={() => onAddProject?.()}>
                  <T>Add project</T>
                </MenuItem>
                <MenuItem onClick={() => onOpenProjectScope?.()}>
                  <T>Project scope</T>
                </MenuItem>
              </MenuPopup>
            </Menu>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={gt("Search")}
              title={gt("Search")}
              onClick={() => onSearch?.()}
            >
              <SearchIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5 md:hidden">
          <SidebarStagePill className="ml-1 hidden @[15rem]/sidebar-header:flex" />
        </div>
      )}
    </div>
  );
});

export function SidebarChromeBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <div className="-ml-px flex h-7 flex-wrap content-start items-center gap-x-2 overflow-hidden pl-(--workspace-titlebar-control-gap) pr-2">
      <SidebarBrand onBackdrop={onBackdrop} />
      <SidebarStagePill />
    </div>
  );
}

function SidebarStagePill({ className }: { className?: string }) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  return pillLabel ? (
    <div className={cn("flex h-7 shrink-0 items-center", className)}>
      <Badge data-environment-identification="pill" size="sm" variant="secondary">
        {pillLabel}
      </Badge>
    </div>
  ) : null;
}

// The footer uses 32px icon-only controls with 16px glyphs (pen C0J52w).
function SidebarUtilityItem({
  icon,
  label,
  onClick,
  onPointerDown,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onPointerDown?: ((event: ReactPointerEvent) => void) | undefined;
}) {
  return (
    <SidebarHeaderIconButton
      label={label}
      size="footer"
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {icon}
    </SidebarHeaderIconButton>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const openLayoutPage = useOpenLayoutPage();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const workflowsReachable = useWorkflowEnvironmentIds().length > 0;
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void openLayoutPage("pull-requests");
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void openLayoutPage("issues");
  };
  const handleWorkflowsClick = () => {
    closeMobileSidebar();
    void openLayoutPage("workflows");
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings", search: { pane: undefined } });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <TooltipProvider>
      <SidebarMenu className="flex-row items-center">
        {isOnUtilityPage ? (
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton size="control" onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>
                <T>Back</T>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          // Keep the utilities in the design's compact, icon-only row.
          <SidebarMenuItem className="shrink-0">
            <div className="flex gap-1">
              <SidebarUtilityItem
                icon={<SettingsIcon className="size-4" />}
                label={gt("Settings")}
                onClick={handleSettingsClick}
              />
              {pullRequestsSupported ? (
                <SidebarUtilityItem
                  icon={<PullRequestGlyph.pullRequest className="size-4" />}
                  label={gt("Pull requests")}
                  onClick={handlePullRequestsClick}
                  onPointerDown={(event) =>
                    beginLayoutContentDrag(event, { kind: "pull-requests" })
                  }
                />
              ) : null}
              {issuesSupported ? (
                <SidebarUtilityItem
                  icon={<IssueGlyph.issue className="size-4" />}
                  label={gt("Issues", { $context: "sidebar link to the list of issues" })}
                  onClick={handleIssuesClick}
                  onPointerDown={(event) => beginLayoutContentDrag(event, { kind: "issues" })}
                />
              ) : null}
              {workflowsReachable ? (
                <SidebarUtilityItem
                  icon={<WorkflowIcon className="size-4" />}
                  label={gt("Workflows")}
                  onClick={handleWorkflowsClick}
                  onPointerDown={(event) => beginLayoutContentDrag(event, { kind: "workflows" })}
                />
              ) : null}
              <SidebarUtilityItem
                icon={<ChartNoAxesColumnIcon className="size-4" />}
                label={gt("Usage")}
                onClick={handleUsageClick}
              />
            </div>
          </SidebarMenuItem>
        )}
        <SidebarThreadUndoNotice />
        <SidebarUpstreamUpdatePill />
        <SidebarUpdatePill />
      </SidebarMenu>
    </TooltipProvider>
  );
});

const DuetSidebarUtilityMenu = memo(function DuetSidebarUtilityMenu() {
  const navigate = useNavigate();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const connectedCount = useConnectedEnvironmentIds().length;
  const { resolvedTheme, setAppearanceChoice } = useTheme();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openSettings = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings", search: { pane: undefined } });
  };
  const openLinkedEnvironments = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings/connections" });
  };
  const dark = resolvedTheme === "dark";
  return (
    <TooltipProvider>
      <div className="flex h-12 items-center gap-1 border-t border-[var(--duet-hairline,var(--border))] px-1">
        <SidebarUtilityItem
          icon={<SettingsIcon className="size-4" />}
          label={gt("Settings")}
          onClick={openSettings}
        />
        <SidebarUtilityItem
          icon={
            <span className="relative inline-flex items-center">
              <EnvironmentMachineIcon kind="server" className="size-4" />
              <span className="absolute -right-1 -bottom-1 rounded-full bg-sidebar px-0.5 text-[9px] leading-3 text-muted-foreground tabular-nums">
                {connectedCount}
              </span>
            </span>
          }
          label={gt("Linked environments")}
          onClick={openLinkedEnvironments}
        />
        <span className="flex-1" />
        <SidebarUtilityItem
          icon={dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          label={dark ? gt("Use light appearance") : gt("Use dark appearance")}
          onClick={() => setAppearanceChoice(dark ? "light" : "dark")}
        />
      </div>
    </TooltipProvider>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const isDuet = useTheme().theme === "ksg-salon";
  return (
    <SidebarFooter className={isDuet ? "gap-0 px-0 pt-0" : undefined}>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      {isDuet ? <DuetSidebarUtilityMenu /> : <SidebarUtilityMenu />}
    </SidebarFooter>
  );
});

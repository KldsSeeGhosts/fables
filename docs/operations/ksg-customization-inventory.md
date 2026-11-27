# KSG customization inventory

This inventory is the merge companion for [KSG fork procedures](ksg-fork.md). It maps the behavior KSG must keep when an upstream nightly moves code or rewrites a feature.

Evidence snapshot: `origin/ksg/dev` `52497d2b72` against `upstream/v0.1.13-nightly.20261125.5258`. Refresh it from git, not memory:

```sh
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag=upstream/v0.1.13-nightly.20261125.5258
git log --first-parent --format='%h %s' origin/ksg/dev --not "$tag"
git diff --name-status "$tag" origin/ksg/dev
git diff upstream ksg/passthrough
git diff ksg/passthrough origin/ksg/dev
```

Use the check commands from the repository root after resolving a merge. They are deliberately cheap greps or existing focused tests. A missing line means the merge probably dropped or moved KSG behavior; inspect before accepting the result. Add a check when a new customization lands.

## Duets server model, delegation, and rollover

Owners: `apps/server/src/captains/`, `apps/server/src/orchestration-v2/CaptainRolloverWorker.ts`, `apps/server/src/mcp/toolkits/captain/`, `packages/contracts/src/captain.ts`, `packages/client-runtime/src/state/captain*.ts`, `packages/client-runtime/src/state/duetOrder.ts`, Captain migrations `112` through `115`, Chorus migrations `125` through `127`, and fleet Chorus migration `128`, and `evals/mcp-tool-use/cases/captain.ndjson`.

Must survive: Captain profiles and kinds, including automatic provisioning by the designated Chorus home and peer-learned home metadata, scoped projects, documents, local and optional [Honcho memory](../user/captain-honcho-memory.md), archive and reset behavior, fleet read and routing tools, coverage-limited Chorus Solos, route ledgers, delegation to crew threads, earlier conversation identity, rollover end reasons, durable resends, coordinator-only Captains, Captain MCP tools, and the client projection that tracks attention across current and earlier conversations.

Checks:

```sh
git grep -n 'class CaptainService' -- apps/server/src/captains/CaptainService.ts
git grep -n 'class CaptainHonchoMemory' -- apps/server/src/captains/CaptainHonchoMemory.ts
git grep -n 'CaptainRolloverWorker' -- apps/server/src/orchestration-v2 apps/server/src
git grep -n 'captainEarlierConversations' -- packages/contracts/src/captain.ts
git grep -n '\[112, "Captains"' -- apps/server/src/persistence/Migrations.ts
git grep -n -E '"CaptainKind"|"ChorusRoutes"|"RemoteChorusRoutes"' -- apps/server/src/persistence/Migrations.ts
```

## Duet web experience

Owners: `apps/web/src/components/captains/`, `apps/web/src/components/chat/Captain*`, `apps/web/src/components/chat/Duet*`, `apps/web/src/components/chat/duet*`, `apps/web/src/hooks/useDuetShell.ts`, `apps/web/src/routes/_chat.captains.tsx`, and the Captain entries in `apps/web/src/components/Sidebar.tsx` and the command palette.

Must survive: the pinned fleet Chorus row, Chorus editing without creation or archive controls, home conflict warnings, the Captains shelf and inbox, Captain editor, tasks drawer, Recaps with machine and Duet grouping, details cards, Duet header chrome and status, earlier conversation stitching in the timeline, approval redirects from ended conversations, Duet-specific tool-call visibility, and the right-panel launcher in Captain tasks.

Checks:

```sh
git grep -n 'export function CaptainsWorkspace' -- apps/web/src/components/captains/CaptainsWorkspace.tsx
git grep -n 'fleetChorus' -- packages/contracts/src/rpc.ts apps/web/src/components/captains/CaptainsShelf.tsx
git grep -n 'export function CaptainEarlierConversations' -- apps/web/src/components/captains/CaptainEarlierConversations.tsx
git grep -n 'export function DuetHeaderTitle' -- apps/web/src/components/chat/DuetHeaderTitle.tsx
git grep -n 'resolveThreadToolCallVisibility' -- apps/web/src/components/chat/MessagesTimeline.tsx packages/client-runtime/src/toolCallVisibility.ts
```

## Mobile Duet shell and adaptive layout

Owners: `apps/mobile/src/features/captains/`, `apps/mobile/src/features/home/DuetThreadsHeader.tsx`, Duet integration in `apps/mobile/src/features/home/HomeScreen.tsx` and `apps/mobile/src/features/threads/ThreadRouteScreen.tsx`, `apps/mobile/src/features/layout/`, `apps/mobile/src/lib/mobileTheme*.ts`, and `apps/mobile/src/persistence/mobile-preferences.ts`.

Must survive: the pinned mobile fleet Chorus row, mobile home-state presentation, the mobile Duet home section, inbox and tasks sheets, conversation orb and creature, adaptive folded and unfolded layouts, one-surface pane treatment in `ksg-salon`, earlier conversation loading above the empty state, approval redirects in earlier conversations, mobile Duet tool-call visibility, and the orb staying clear of the composer.

Checks:

```sh
git grep -n 'CaptainsHomeSection' -- apps/mobile/src/features/home/HomeScreen.tsx
git grep -n 'useFleetChorus' -- apps/mobile/src/features/captains/useCaptainsDirectory.ts
git grep -n 'DuetConversationOrb' -- apps/mobile/src/features/threads/ThreadRouteScreen.tsx
git grep -n 'ksg-salon' -- apps/mobile/src/features/captains/duetShell.ts apps/mobile/src/lib/mobileTheme.ts
git grep -n 'duetToolCallVisibility' -- apps/mobile/src/persistence/mobile-preferences.ts packages/contracts/src/settings.ts
```

## Workspace shell, sidebar, and pane layout

Owners: `apps/web/src/layout/`, `apps/web/src/motion/`, `apps/web/src/components/AppSidebarLayout.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/sidebar/`, `apps/web/src/components/settings/Layout*.tsx`, `apps/web/src/routes/_chat.settings.layout.tsx`, `docs/user/layout.md`, and the `@legendapp/list` patch in `patches/`.

Must survive: tabs, panes, columns, workspaces, scrolling workspaces, the overview, drag and keyboard movement, surface tabs for chat terminals and files, layout onboarding and settings, sidebar collapse and edge restore, resize behavior, thread triage and snooze rows with accessible wake text, and measurement in layout pixels while the overview is scaled.

Checks:

```sh
git grep -n 'export function WorkspacePlane' -- apps/web/src/layout/WorkspacePlane.tsx
git grep -n 'collapseOnResize: true' -- apps/web/src/components/AppSidebarLayout.tsx
git grep -n 'snoozeWakeLabelText' -- apps/web/src/components/Sidebar.tsx apps/web/src/components/sidebar/SidebarThreadRow.tsx
git grep -n 'measureLayoutRect' -- patches/@legendapp__list@3.9.0.patch
```

## Pull request and file surfaces in the KSG layout

Owners: `apps/web/src/components/pullRequest/`, `apps/server/src/pullRequest/PullRequestService.ts`, `packages/source-control-github/src/server/`, `apps/web/src/components/files/`, and `apps/web/src/components/chat/OpenInPicker*`.

Must survive: pull request surfaces as movable layout tabs, the readiness card and quiet entries, stack grouping, GitHub stack auto-merge and cancel actions pinned to the reviewed head and affected layers, file previews as surfaces, and file-manager actions gated until the preview read knows whether the path can be opened or revealed.

Checks:

```sh
git grep -n 'export function PullRequestStackMenu' -- apps/web/src/components/pullRequest/PullRequestStackMenu.tsx
git grep -n 'canAutoMerge' -- apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx apps/web/src/components/pullRequest/PullRequestStackMenu.tsx
git grep -n 'fileManagerActionForPath' -- apps/web/src/components/chat/OpenInPicker.logic.ts apps/web/src/components/files/FilePreviewPanel.tsx
git grep -n 'canOpenPreferredEditor' -- apps/web/src/components/chat/OpenInPicker.tsx
```

## KSG Salon, themes, design system, and app icons

Owners: `apps/web/src/themes/ksg-salon.css`, `packages/shared/src/themePalettes.ts`, `apps/web/src/themePalette.ts`, `apps/web/src/index.css`, `apps/mobile/scripts/generate-uniwind-themes.mts`, `apps/mobile/src/lib/mobileTheme*.ts`, `apps/web/public/app-icons/`, `packages/shared/src/appIcons.ts`, `apps/web/src/appIcon.ts`, `apps/web/src/components/design-system/`, and the KSG rules in `oxlint-plugin-t3code/rules/`.

Must survive: `ksg-salon` as the unset default, its light and dark halves, Duet typography and flat pane geometry, Claude and Cursor bundled themes, T3 Code Classic, theme-aware mobile native bars, selectable app icons, type-role and raw-control lint rules, and generated mobile theme catalogs matching the shared palettes.

Checks:

```sh
git grep -n '"ksg-salon"' -- packages/shared/src/themePalettes.ts
git grep -n 'UNSET_THEME_DEFAULT: Theme = "ksg-salon"' -- apps/web/src/hooks/useTheme.ts
git grep -n 'ksg-salon.css' -- apps/web/src/index.css
git grep -n 'APP_ICONS' -- packages/shared/src/appIcons.ts
```

## Native desktop appearance and controls

Owners: `apps/desktop/src/app/DesktopAppIdentity.ts`, `apps/desktop/src/app/DesktopAssets.ts`, `apps/desktop/src/window/DesktopWindow.ts`, `apps/desktop/src/electron/ElectronTheme.ts`, and window IPC in `apps/desktop/src/ipc/methods/window.ts` and `apps/desktop/src/preload.ts`.

Must survive: applying custom dock and window icons on launch and reverting to the packaged icon, matching native chrome to the selected theme, and positioning the macOS window buttons at the current zoom level.

Checks:

```sh
git grep -n 'applyAppIcon' -- apps/desktop/src/app/DesktopAppIdentity.ts
git grep -n 'macosWindowButtonPosition' -- apps/desktop/src/window/DesktopWindow.ts
git grep -n 'setBlackChrome' -- apps/desktop/src/electron/ElectronTheme.ts
```

## CPA usage limits and hub quota routing

Owners: `apps/server/src/usage/cpaManager.ts`, `apps/server/src/usage/UsageLimitSources.ts`, `apps/server/src/serverSettings.ts`, `packages/contracts/src/providerUsageLimits.ts`, `packages/shared/src/usageLimits.ts`, `packages/shared/src/usageLimitsCopy.ts`, `apps/web/src/components/usage/CpaAccounts.tsx`, `apps/mobile/src/features/usage/CpaAccounts.tsx`, and usage settings on both clients.

Must survive: the `cpa-manager` source kind, quota and auth-file inventory decoding without exposing secrets, disabled and synthetic account handling, per-model quota window selection, endpoint-scoped hub matching, reset recovery for the routed model, pooled provider limits for custom endpoints, CPA account presentation on web and mobile, and settings projection that keeps upstream mobile clients decodable.

Checks:

```sh
git grep -n '"cpa-manager"' -- packages/contracts/src/providerUsageLimits.ts apps/server/src/serverSettings.ts
git grep -n 'usageLimitsForModel' -- apps/server/src/usage/UsageLimitSources.ts packages/shared/src/usageLimits.ts
git grep -n 'usageLimitHubsAtEndpoint' -- apps/server/src/usage/UsageLimitSources.ts packages/shared/src/usageLimits.ts
git grep -n 'export function CpaAccounts' -- apps/web/src/components/usage/CpaAccounts.tsx apps/mobile/src/features/usage/CpaAccounts.tsx
```

## Provider and ACP adaptations

Owners: `apps/server/src/provider/`, `apps/server/src/provider/acp/Antigravity*`, `packages/provider-acp/src/server/activeSteering.ts`, `packages/provider-acp/src/server/elicitation.ts`, `packages/provider-acp-registry/src/server/agentProfile.ts`, `packages/provider-pi/src/server/userInput.ts`, and maintenance files under `packages/provider-core/src/server/`.

Must survive: Antigravity gateway family grouping, effort routes, route label cleanup, and configured tier retention; ACP active steering and form elicitation; Pi questionnaire reconstruction; instance-aware Claude update configuration with `CLAUDE_CONFIG_DIR`; Codex native update lookup through its release channel and instance environment; custom endpoint auth reporting; and bounded noninteractive provider maintenance probes.

Checks:

```sh
git grep -n 'antigravityGatewayModelRows' -- apps/server/src/provider/acp/AntigravityGatewayModels.ts apps/server/src/provider/acp/AntigravityAcpSupport.ts
git grep -n 'supportsAcpActiveSteering' -- packages/provider-acp/src/server/activeSteering.ts packages/provider-acp/src/server/adapter.ts
git grep -n 'makeAcpElicitationForm' -- packages/provider-acp/src/server/elicitation.ts packages/provider-acp/src/server/adapter.ts
git grep -n 'piQuestionnaireQuestion' -- packages/provider-pi/src/server/userInput.ts packages/provider-pi/src/server/adapter.ts
git grep -n 'makeCodexMaintenanceResolver' -- apps/server/src/provider/Drivers/codexMaintenance.ts apps/server/src/provider/Drivers/CodexDriver.ts
```

## Composer context meter

Owners: `apps/web/src/components/chat/ContextWindowMeter.tsx`, `apps/web/src/components/chat/compaction.logic.ts`, `apps/web/src/components/chat/ThreadDetailsUsage.tsx`, `packages/client-runtime/src/state/contextWindow.ts`, context breakdown fields in `packages/contracts/src/`, and `apps/server/src/provider/agentContextBudget.json`.

Must survive: the details panel context meter, provider-reported category breakdowns, fallback cache and reasoning segments, compact accessibility labels, and the adjusted MCP tool-list budget caused by KSG's added tools. In `agentContextBudget.json`, keep upstream's `codexAdditionalContextBytes` and preserve KSG's larger `mcpToolListJsonBytes` unless the Captain MCP tool manifest changed enough to require recalibration.

Checks:

```sh
git grep -n 'export function ContextWindowSegments' -- apps/web/src/components/chat/ContextWindowMeter.tsx
git grep -n 'breakdown' -- packages/client-runtime/src/state/contextWindow.ts packages/contracts/src/providerRuntime.ts
git grep -n 'mcpToolListJsonBytes' -- apps/server/src/provider/agentContextBudget.json
```

## Fork branding, upstream review, and update feeds

Owners: `packages/shared/src/forkUpstream.ts`, `apps/web/src/state/upstreamNightly.ts`, `apps/web/src/components/settings/UpstreamNightlySettings.tsx`, `apps/web/src/components/sidebar/SidebarUpstreamUpdatePill.tsx`, `packages/shared/src/cliRelease.ts`, `apps/web/src/state/npmRelease.ts`, `apps/web/src/components/sidebar/useUpdateEverything.ts`, `apps/web/src/components/settings/UpdateTrackSwitchDialog.tsx`, `apps/web/src/components/desktopUpdate.logic.ts`, `scripts/build-desktop-artifact.ts`, and KSG text and screenshots in `README.md` and `.github/readme/`.

Must survive: KSG product naming, the exact included upstream baseline embedded as `VITE_KSG_UPSTREAM_TAG`, comparison against the exact included upstream nightly, the review link and copyable merge prompt, CLI release lookups in `KldsSeeGhosts/fables` rather than npm, verification that a server update target is published before updating, provider updates before server updates and desktop last, and update feeds from the fork repository.

Checks:

```sh
git grep -n 'T3_UPSTREAM_REPOSITORY = "pingdotgg/t3code"' -- packages/shared/src/forkUpstream.ts
git grep -n 'KldsSeeGhosts/fables' -- packages/shared/src/cliRelease.ts apps/web/src/state/npmRelease.test.ts
git grep -n 'upstreamMergePrompt' -- packages/shared/src/forkUpstream.ts apps/web/src/components/settings/UpstreamNightlySettings.tsx apps/web/src/components/sidebar/SidebarUpstreamUpdatePill.tsx
git grep -n 'useCliReleasePublished' -- apps/web/src/components/sidebar/useUpdateEverything.ts apps/web/src/state/npmRelease.ts
```

## Release workflow, signing, versioning, and mobile distribution

Owners: `.github/workflows/ksg-release.yml`, `.github/workflows/release-desktop.yml`, `.github/scripts/ksg-release-notes.cjs`, `scripts/build-desktop-artifact.ts`, `scripts/sign-macos.ts`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, and the release sections of `docs/operations/ksg-fork.md`.

Must survive: publication from pushes to `ksg/dev`, plain semver with the series in `.github/fables-release-series` and the patch derived from fork tags, embedded upstream provenance, staging of the web asset manifest before artifact upload, macOS artifact reuse and signing on the KSG runner, unsigned Windows NSIS with the Linux CLI archive for WSL, renaming the Windows updater manifest to `nightly.yml`, descriptive release notes that separate KSG and upstream changes, KSG macOS signing fallbacks failing closed, and mobile updates owned by the `kidsseeghosts/ksg-code` EAS project with preview channel routing.

Checks:

```sh
git grep -n 'name: KSG Release' -- .github/workflows/ksg-release.yml
git grep -n 'Stage web asset manifest' -- .github/workflows/ksg-release.yml
node --test .github/scripts/ksg-release-version.test.cjs
git grep -n 'kidsseeghosts\|0db5bfe2-75db-4fa0-a957-e2ef19fac1d8' -- apps/mobile/app.config.ts apps/mobile/app.config.test.ts
```

## Migration renumbering

KSG databases already recorded Captain migrations `112` through `115` and Chorus migrations `125` through `127`. Newly integrated upstream migrations with IDs `112` or higher must move forward by four in the filename, manifest ID, and manifest import. In the 5258 baseline this means upstream `112` through `119` are KSG `116` through `123`. Keep all previously shipped migration IDs and files intact.

Checks:

```sh
git grep -n '\[112, "Captains"' -- apps/server/src/persistence/Migrations.ts
git grep -n -E '"CaptainKind"|"ChorusRoutes"|"RemoteChorusRoutes"' -- apps/server/src/persistence/Migrations.ts
git grep -n '\[116, "LayoutCommandApprovals"' -- apps/server/src/persistence/Migrations.ts
test -f apps/server/src/persistence/Migrations/116_LayoutCommandApprovals.ts
test -f apps/server/src/persistence/Migrations/123_WorkflowRunSubject.ts
```

## Known traps from the 5258 sync

These regressions were caught after the last sync. Treat them as required review points, even when upstream owns part of the underlying feature:

- Sidebar triage must use the offline triage grant for single-thread menus. Check `canTriageThread` in `apps/web/src/components/sidebar/SidebarThreadRow.tsx`.
- Snoozed rows must keep their translated relative wake time. Check `snoozeWakeLabelText` in `apps/web/src/components/Sidebar.tsx` and `apps/web/src/components/sidebar/SidebarThreadRow.tsx`.
- The sidebar must collapse offcanvas and restore from the edge on resize. Check `collapseOnResize: true` in `apps/web/src/components/AppSidebarLayout.tsx`.
- File-manager open and reveal actions must stay disabled until the preview read provides the path operation. Check `fileManagerActionForPath` and `canOpenPreferredEditor`.
- GitHub stack auto-merge and cancel must remain visible in the KSG pull request layout and pin the expected stack heads. Check `canAutoMerge` in the pull request components.
- Hub quota recovery must select windows for the routed account driver and model, not every depleted model in the hub. Check `usageLimitsForModel` in `apps/server/src/usage/UsageLimitSources.ts`.
- The release workflow must stage `vite-manifest.release.json` before upload. Check `Stage web asset manifest` in `.github/workflows/ksg-release.yml`.

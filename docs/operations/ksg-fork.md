# KSG fork procedures

> For KSG maintainers. The always-on rules are in [AGENTS.md](../../AGENTS.md#ksg-fork-rules).

Fables follows [T3 Code](https://github.com/pingdotgg/t3code), with its own
updates, branding, signing, and customizations. The CLI remains `t3`, state
remains in `~/.t3`, and the app ID remains `com.t3tools.t3code`. KSG and upstream
share state and must not run side by side.

## Desktop display name and update paths

Fables is the display name. Keep the existing release filenames, app ID,
update feed, signing settings, and Electron profile paths.

- **macOS.** electron-builder uses `mac.executableName` for both the bundle
  filename and the main executable, so the package contains
  `Fables.app/Contents/MacOS/Fables`. The published DMG and ZIP filenames
  still start with `KSG-Code-`. electron-updater hands the ZIP to Squirrel.Mac,
  which finds the update by the running app's bundle ID and checks the update
  against the installed app's code-signing requirement. On the first update
  with the new name, ShipIt moves `/Applications/KSG Code.app` to
  `/Applications/Fables.app` before replacing it. ShipIt renames only when the
  installed bundle's basename matches its current `CFBundleExecutable` and
  the destination is free. A custom bundle name or an occupied destination
  leaves the existing bundle path in use, with the new executable inside.
  On macOS 11 or later, relaunch can fail after a rename because ShipIt tries
  to restart its helper at the old path. If Fables does not reopen, open it
  from Applications.
  Dock pins, login items, and shortcuts that refer to the old path may need
  updating. Electron still reads its profile from
  `~/Library/Application Support/t3code-v2`. See the ShipIt sources for the
  [rename flag](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L1073-L1083),
  [destination](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m#L550-L569),
  and [relaunch](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/ShipIt-main.m#L168-L206).
- **Windows.** Keep `win.executableName` on the existing filename.
  electron-updater's `out/NsisUpdater.js` launches the NSIS installer.
  electron-builder's `out/targets/nsis/NsisTarget.js` derives the install
  GUID from the app ID. `templates/nsis/multiUser.nsh` reads that registry
  key's `InstallLocation`, and `templates/nsis/include/installer.nsh` renames
  existing Desktop and Start Menu shortcuts to the new product name. Their
  executable target and AppUserModelID stay valid.
- **Linux.** Keep the builder's product name for the Debian install path.
  `out/targets/FpmTarget.js` and `out/targets/LinuxTargetHelper.js` derive
  that path from the sanitized product name. Override the desktop entry's
  `Name` and use Fables in the package metadata. Keep the `t3code` binary
  and the published AppImage filenames. In `out/AppImageUpdater.js`,
  electron-updater replaces the file at `APPIMAGE` when its basename is
  unversioned or matches the download. For a different versioned basename,
  it removes the old file and installs the download beside it under the
  download's basename.

## Syncing with upstream

Choose a published upstream release, not a tag from the fork's mixed tag list.
Settings → About shows the installed build's included upstream
nightly and offers a review link and merge prompt when a newer one exists.
Checking never merges, publishes, or installs anything. Use the
[KSG customization inventory](ksg-customization-inventory.md) while resolving
each merge layer.

These commands assume a single checkout. If a branch already has a worktree,
run its merge commands there instead of switching or force-moving it. Start
with clean worktrees. Run one command at a time. If any command fails, stop and
resolve it before continuing. Finish each layer before starting the next.

```sh
git config rerere.enabled true
git config rerere.autoupdate false
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag="$(gh api 'repos/pingdotgg/t3code/releases?per_page=100' --jq '[.[] | select(.draft == false and .published_at != null and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-nightly\\.[0-9]{8}\\.[0-9]+$")))] | max_by(.published_at).tag_name')"
test -n "$tag" && test "$tag" != null
upstream_ref="refs/tags/upstream/$tag"
git rev-parse --verify "$upstream_ref^{commit}"

git switch upstream
git merge-base --is-ancestor HEAD "$upstream_ref"
git merge-base --is-ancestor origin/upstream "$upstream_ref"
git merge --ff-only origin/upstream && git merge --ff-only "$upstream_ref"
test "$(git rev-parse HEAD)" = "$(git rev-parse "$upstream_ref^{commit}")"
git switch ksg/passthrough && git merge --ff-only origin/ksg/passthrough && git merge --no-edit upstream
git switch ksg/dev && git merge --ff-only origin/ksg/dev && git merge --no-edit ksg/passthrough
vp i
```

Review the selected release and both merge layers. Inspect
`git diff upstream ksg/passthrough` for distribution patches and
`git diff ksg/passthrough ksg/dev` for customizations. Use the
[customization inventory](ksg-customization-inventory.md) to identify the
owning files, required behavior, and cheap post-merge checks. Preserve the
intent of the fork's patches and use upstream behavior elsewhere. If code
moved, reapply the patch where it moved. Stop and report when a
conflict makes that intent unclear rather than guessing. Run focused tests and
affected package typechecks. Branches move forward by merges, never rebases or
force-pushes.

Remap each newly integrated upstream migration ID that collides with or
precedes a shipped KSG ID to the next free ID after the highest shipped KSG ID.
Update the filename, manifest ID, and manifest import for each remapped
migration. Keep shipped migration IDs and files intact. Check the mapping even
when Git merges cleanly.

Only after approval, push `upstream`, `ksg/passthrough`, and `ksg/dev`.
Pushing `ksg/dev` can publish a release; it is not just a source backup.

## Versions and update feeds

Fables releases use plain semver starting at `0.2.0`.
[The release series](../../.github/fables-release-series) sets `MAJOR.MINOR`.
The release workflow reads the fork's tags and uses the next patch in that
series, starting at zero. A fork-only release leaves the series file alone.
When integrating a new upstream nightly, change the one line in that file to
the next minor, for example `0.2` to `0.3`, before publishing `ksg/dev`.
Change the major only when the owner approves it.

The release workflow embeds the exact included upstream tag in the web bundle
as `VITE_KSG_UPSTREAM_TAG` and records it in every release's notes. Settings
compares that tag with published upstream nightlies. Plain-version builds
without the embedded tag show an unknown baseline. Older encoded builds can
still derive their included upstream nightly from the version.

GitHub publishes Fables as pre-releases. Plain versions use the desktop
Stable track and CLI `stable` channel. The GitHub desktop provider finds them
in the release feed and loads the existing `nightly.yml`, `nightly-mac.yml`,
or `nightly-linux.yml` asset. A managed mirror uses the configured desktop
track name, so it serves plain versions with `latest*.yml`.

### One-time bridge to 0.2.0

1. Push the bridge changes to `ksg/dev` with the release series set to
   `bridge`. Keep the included upstream nightly at
   `v0.1.13-nightly.20261126.5305` for this release. The workflow continues
   the fork counter, starting at `0.1.13-nightly.20261126.530504`. Existing
   Nightly clients pick it up through their usual updater.
2. Wait for the bridge release to publish with all three nightly manifests and
   the CLI archives. Check that a legacy desktop can install it and that
   enrolled servers can stage it. The bridge desktop moves a saved Nightly
   choice to Stable. The bridge CLI and server also follow Stable.
3. Change the series line from `bridge` to `0.2` and push to `ksg/dev`
   again. The workflow publishes `0.2.0` on the same GitHub feed with the same
   nightly manifest names. The bridge can now offer it through the normal
   update flow. Keep the bridge published so legacy clients that come back
   online later can take both updates.

CLI archives and the release-availability check use this fork's GitHub
releases. For desktop release builds, GitHub Actions supplies
`GITHUB_REPOSITORY=KldsSeeGhosts/fables`. Set
`T3CODE_DESKTOP_UPDATE_REPOSITORY` to override it or to configure the feed for
a local package build. The sidebar updater updates providers, connected
servers, then the local desktop last. Upstream merge checks must never replace
the KSG installation with an upstream artifact.

## Mobile updates

KSG iOS updates use `@kidsseeghosts/ksg-code`. Install a preview IPA built
with this project and its `preview` channel before publishing updates to it.
Publish JavaScript-only changes as an update when the native fingerprint
matches. Native changes that alter the fingerprint require a new IPA.
Expo prebuild uses the Fables app name for the iOS `CFBundleDisplayName`
and the Android `app_name` resource. Install a new native build to update the
launcher label. Use the same bundle ID, EAS project, and update channel.

From `apps/mobile`, publish an iOS preview update with the same build-time
settings as the IPA. Read `EXPO_TOKEN` from a file outside the repository.

```sh
(
  EXPO_TOKEN="$(cat /path/outside/repo/expo-token)" || exit 1
  export EXPO_TOKEN
  APP_VARIANT=preview eas update --channel preview --platform ios \
    --environment preview --message "Describe the update" --non-interactive
)
```

## Release notes

- Use descriptive conventional commit and PR titles that name the user-visible
  feature or fix, not generic summaries such as "updates" or "merge changes".
- The KSG release workflow generates notes from commits since the previous
  published KSG release, including direct commits and local branch merges.
  It separates KSG changes from the newly included upstream nightly's changes.
  Documentation, test, and formatting-only commits are omitted; rebuilds are
  identified.
- Before publishing, review the actual release body for meaningful feature and
  fix bullets. Distinguish KSG changes from newly included upstream changes.
  A compare link alone is not a useful changelog. Do not change published notes
  or release automation without the user's authorization.

## Releases and macOS signing

`.github/workflows/ksg-release.yml` publishes pushes to `ksg/dev`
(except Markdown-only pushes), or manual dispatches. It builds macOS arm64,
Linux x64 and Windows x64 using upstream's reusable desktop workflow. The
Windows build is an unsigned NSIS installer (the fork has no Azure Trusted
Signing secrets) that embeds the Linux CLI archive for WSL; the release job
renames its `nightly-win-x64.yml` manifest to `nightly.yml` for electron-updater.

- Keep `KSG Release` and `Release desktop build` enabled in Actions. Other
  upstream workflows need upstream's runners and secrets and should stay disabled.
- Personal macOS releases use `KSG_MACOS_DEVELOPMENT_P12` and
  `KSG_MACOS_DEVELOPMENT_P12_PASSWORD`, with the certificate SHA-1 pinned by the
  `KSG_MACOS_DEVELOPMENT_IDENTITY` repository variable. This reuses the existing
  Noches Apple Development identity, team `78295MJ4K8`, without changing Noches.
  The current certificate expires September 28, 2027. Renew it before expiry
  using the same Apple team and verify update compatibility before publishing.
- The old `KSG_MACOS_P12` and `KSG_MACOS_P12_PASSWORD` remain a self-signed
  fallback only when development secrets are absent. Incomplete or invalid
  development signing fails the build instead of silently changing identity.
  Complete Developer ID and notarization credentials still take precedence.
- Keep certificates, private keys, `.p12` files, and signing keychains outside
  this repository. For a local build, prepare an external keychain with the
  existing identity, set `T3CODE_MACOS_DEVELOPMENT=true`, `CSC_KEYCHAIN`, and
  `T3CODE_MACOS_SIGNING_IDENTITY` to the certificate SHA-1,
  and run `node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --signed`.
  Do not set `CSC_LINK` for this path. Legacy self-signed builds use
  `T3CODE_MACOS_SELF_SIGNED=true` instead.
- Optional `KSG_RELAY_URL` and `KSG_CLERK_*` repository variables enable T3
  Connect. Without them, it is omitted.
- If pushing workflows is denied, stop and ask the user to authorize the
  required GitHub workflow permission. Do not change authentication yourself.

Personal builds skip notarization and team-dependent passkey entitlements.
They are not notarized public distribution; CLI archives remain ad hoc unless
separate Developer ID credentials are configured. The first launch may require
Finder's Open command.

Switching an installed self-signed KSG app to Apple Development requires one
manual reinstall, since the old updater pins the self-signed certificate.
Expect one final Keychain approval and possibly renewed privacy permissions.
Thereafter Apple-signed builds use a stable team partition rather than a
changing build hash for Keychain access. Confirm real Electron safeStorage and
the production updater after the manual cutover. Never replace or restart the
live app during a release-configuration change.

## Server cutover and launcher compatibility

The boot-service launcher stays pinned across self-updates. The running server,
not the launcher, downloads its replacement from its compiled release repository.

- The first hop from upstream to KSG needs the fork's `t3 update <version>`
  locally, or the service download override
  `T3CODE_RELEASE_BASE_URL=https://github.com/KldsSeeGhosts/fables/releases/download`.
  After cutover, the KSG runtime uses this fork's feed.
- Replace upstream or npm-installed `t3` commands on `PATH` with the fork's
  archive, or local update and service commands will still use upstream.
- If upstream raises `SERVICE_LAUNCHER_PROTOCOL`, preflight blocks updates
  under an older launcher. Run `t3 service install` from the new fork binary
  locally to repin the service. Do not work around that safety check.

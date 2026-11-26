# KSG fork procedures

> For KSG maintainers. The always-on rules are in [AGENTS.md](../../AGENTS.md#ksg-fork-rules).

Fables follows [T3 Code](https://github.com/pingdotgg/t3code), with its own
updates, branding, signing, and customizations. The CLI remains `t3`, state
remains in `~/.t3`, and the app ID remains `com.t3tools.t3code`. KSG and upstream
share state and must not run side by side.

## Desktop display name and update paths

Fables is the display name. The existing artifact names, app ID, updater
manifests, signing settings, and Electron profile paths are part of the
distribution and stay stable across the rename.

- **macOS.** electron-builder's `out/appInfo.js` derives the package filename
  from `mac.executableName`. `out/macPackager.js` and
  `out/electron/electronMac.js` use it for the bundle and binaries, and use
  `productName` for the display name in Info.plist. Keep
  `/Applications/KSG Code.app` and its executable name. electron-updater's
  `out/MacUpdater.js` gives the ZIP to Electron's native updater. Squirrel.Mac
  matches the running bundle ID and verifies the signature. When the installed
  bundle's basename matches its executable name, ShipIt can rename the
  destination to match the ZIP before replacing it. Keeping the ZIP's bundle
  name preserves the installed path and any shortcuts to it. A custom bundle
  name chosen by the user stays in place. See
  [SQRLUpdater.m](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m)
  and [SQRLInstaller.m](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m).
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
Checking never merges, publishes, or installs anything.

These commands assume a single checkout. If a branch already has a worktree,
run its merge commands there instead of switching or force-moving it. Start
with clean worktrees. If any command fails, stop and resolve it before continuing.

```sh
git config rerere.enabled true
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag="$(gh api 'repos/pingdotgg/t3code/releases?per_page=100' --jq '[.[] | select(.draft == false and .published_at != null and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-nightly\\.[0-9]{8}\\.[0-9]+$")))] | max_by(.published_at).tag_name')"
test -n "$tag" && test "$tag" != null
upstream_ref="refs/tags/upstream/$tag"
git rev-parse --verify "$upstream_ref^{commit}"

git switch upstream && git merge --ff-only origin/upstream && git merge --ff-only "$upstream_ref"
git switch ksg/passthrough && git merge --ff-only origin/ksg/passthrough && git merge --no-edit upstream
git switch ksg/dev && git merge --ff-only origin/ksg/dev && git merge --no-edit ksg/passthrough
vp i
```

Review the selected release and both merge layers. Inspect
`git diff upstream ksg/passthrough` for distribution patches and
`git diff ksg/passthrough ksg/dev` for customizations. Upstream wins outside
their intent. If code moved, reapply the intent where it moved; never drop a
patch to resolve a conflict. Run focused tests and affected package typechecks.
Branches move forward by merges, never rebases or force-pushes.
KSG databases already recorded Captain migrations 112–115. When syncing later
upstream migrations, add four to the upstream ID in the filename and manifest.

Only after approval, push `upstream`, `ksg/passthrough`, and `ksg/dev`.
Pushing `ksg/dev` can publish a release; it is not just a source backup.

## Versions and update feeds

Releases use `X.Y.Z-nightly.YYYYMMDD.N`. The base version and date come from
the included upstream nightly, and `N = upstream run * 100 + fork counter`,
where the counter is 1 through 99. Upstream `.3093` becomes fork `.309301`,
then `.309302` for a fork-only rebuild. Successive fork releases sort correctly;
do not compare the fork's larger run number directly with an upstream version.

The release workflow embeds the exact included upstream tag in the web bundle
as `VITE_KSG_UPSTREAM_TAG`. Settings compares that tag with upstream releases,
with the encoded fork version as a fallback for manual builds. Fork-only
rebuilds do not advance this baseline. Integrating and publishing a new nightly
advances it automatically, including multiple upstream nightlies on one day.
Unversioned development builds without metadata report an unknown baseline.

CLI archives and the release-availability check must use this fork's GitHub
releases, not npm. The desktop feed comes from `GITHUB_REPOSITORY` or
`T3CODE_DESKTOP_UPDATE_REPOSITORY` at build time. The sidebar updater updates
providers, connected servers, then the local desktop last. Upstream merge
checks must never replace the KSG installation with an upstream artifact.

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
  `T3CODE_RELEASE_BASE_URL=https://github.com/KldsSeeGhosts/ksgcode/releases/download`.
  After cutover, the KSG runtime uses this fork's feed.
- Replace upstream or npm-installed `t3` commands on `PATH` with the fork's
  archive, or local update and service commands will still use upstream.
- If upstream raises `SERVICE_LAUNCHER_PROTOCOL`, preflight blocks updates
  under an older launcher. Run `t3 service install` from the new fork binary
  locally to repin the service. Do not work around that safety check.

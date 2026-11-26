import { compareSemverVersions } from "./semver.ts";

export const T3_UPSTREAM_REPOSITORY = "pingdotgg/t3code";
const NIGHTLY_VERSION = /^\d+\.\d+\.\d+-nightly\.\d{8}\.[1-9]\d*$/;

/** KSG encodes the upstream run as run * 100 + a counter from 1 to 99. */
export function upstreamVersionFromFork(version: string): string | null {
  if (!NIGHTLY_VERSION.test(version)) return null;
  const separator = version.lastIndexOf(".");
  const run = Number(version.slice(separator + 1));
  if (!Number.isSafeInteger(run) || run < 101 || run % 100 === 0) return null;
  return `${version.slice(0, separator + 1)}${Math.floor(run / 100)}`;
}

export function resolveForkUpstreamVersion(
  forkVersion: string,
  upstreamTag: string | undefined,
): string | null {
  const version = upstreamTag?.replace(/^v/, "");
  return version && NIGHTLY_VERSION.test(version) ? version : upstreamVersionFromFork(forkVersion);
}

export interface UpstreamRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly published_at: string | null;
}

/** GitHub orders by creation, not version. Ignore drafts, stable and preview releases. */
export function newestUpstreamNightly(releases: ReadonlyArray<UpstreamRelease>) {
  let newest: { readonly version: string; readonly publishedAt: string } | null = null;
  for (const release of releases) {
    if (release.draft || !release.published_at || !release.tag_name.startsWith("v")) continue;
    const version = release.tag_name.slice(1);
    if (!NIGHTLY_VERSION.test(version)) continue;
    if (newest === null || compareSemverVersions(version, newest.version) > 0) {
      newest = { version, publishedAt: release.published_at };
    }
  }
  return newest;
}

export function compareForkUpstream(includedVersion: string | null, latestVersion: string) {
  if (includedVersion === null) return "unknown";
  return compareSemverVersions(latestVersion, includedVersion) > 0 ? "behind" : "current";
}

export function upstreamReviewUrl(includedVersion: string | null, latestVersion: string): string {
  const repositoryUrl = `https://github.com/${T3_UPSTREAM_REPOSITORY}`;
  return includedVersion !== null &&
    compareForkUpstream(includedVersion, latestVersion) === "behind"
    ? `${repositoryUrl}/compare/v${includedVersion}...v${latestVersion}`
    : `${repositoryUrl}/releases/tag/v${latestVersion}`;
}

export function upstreamMergePrompt(latestVersion: string): string {
  const tag = `v${latestVersion}`;
  return `Sync KSG Code with published upstream nightly ${tag} from ${T3_UPSTREAM_REPOSITORY}.

Read AGENTS.md, docs/operations/ksg-fork.md, and docs/operations/ksg-customization-inventory.md before running any merge. Work only in the KSG checkout. Do not use GitHub's "Sync fork", git rebase, or a force push. Never install an upstream artifact over KSG. Never push, publish a release, or update a running device. Pushing requires a separate explicit user approval after your report.

## 1. Preflight

Run these commands from the KSG repository root:

\`\`\`sh
git config rerere.enabled true
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag="${tag}"
upstream_ref="refs/tags/upstream/$tag"
git rev-parse --verify "$upstream_ref^{commit}"
git worktree list
git status --short --branch
\`\`\`

The selected tag is exactly ${tag}. Do not substitute upstream main, another nightly, or a tag outside refs/tags/upstream/*. Record the verified commit. Stop before changing anything if the tag is missing, the worktrees are dirty, a required branch is missing, or the checkout does not match the procedure.

The upstream, ksg/passthrough, and ksg/dev branches may already be checked out in separate worktrees. Use git worktree list to find them. If a branch has its own worktree, run that branch's merge commands there. Never force-move or switch a branch out from under another worktree.

## 2. Merge forward, merges only

In a single checkout the branch sequence is:

\`\`\`sh
git switch upstream && git merge --ff-only origin/upstream && git merge --ff-only "$upstream_ref"
git switch ksg/passthrough && git merge --ff-only origin/ksg/passthrough && git merge --no-edit upstream
git switch ksg/dev && git merge --ff-only origin/ksg/dev && git merge --no-edit ksg/passthrough
vp i
\`\`\`

When the branches already occupy separate worktrees, run the same two merge commands for each branch inside its owning worktree instead of git switch. Fast-forward each branch to its origin branch first. Then merge the previous layer. If a fast-forward fails because the local branch has diverged, stop and report that fact. Do not repair it with rebase or force.

## 3. Resolve conflicts by preserving KSG intent

When a merge stops with conflicts, run git status --short and keep the complete conflict list for the final report. For every conflicted path:

1. Find the owning area in docs/operations/ksg-customization-inventory.md.
2. Inspect git diff upstream ksg/passthrough for distribution patches and git diff ksg/passthrough ksg/dev for customizations.
3. Preserve the inventory behavior and the intent of the KSG patch. Upstream wins only outside that intent.
4. If upstream moved the code, reapply the KSG behavior at the new location. Never drop a KSG patch merely to make the conflict disappear.
5. KSG databases already recorded Captain migrations 112 through 115. When upstream adds migrations in that range, add four to the upstream ID in both filename and manifest entry. Do not renumber the Captain migrations.
6. If the correct resolution is uncertain, stop with MERGE BLOCKED, name the path and the choices, and ask for a decision. Do not guess.

## 4. Required checks before reporting success

Run the inventory's check commands. Run focused tests for every affected area and the typecheck for every affected package. Examples:

\`\`\`sh
vp test run packages/shared/src/forkUpstream.test.ts
(cd apps/web && vp run typecheck)
vp run i18n:check
\`\`\`

Use the conflict list to choose additional focused tests, such as Captain, layout, sidebar, pull request, provider, usage, release, or migration tests. If a check fails, fix the merge and rerun it. If you cannot fix it without ambiguity, stop and report the failing command and output. Do not claim success with a failing or skipped required check.

## 5. Final report format

End with this exact structure:

\`\`\`text
## Result
- Upstream tag and commit:
- upstream merge commit or head:
- ksg/passthrough merge commit or head:
- ksg/dev merge commit or head:

## Conflicts
- path | branch layer | resolution | evidence or check

## Checks
- command | pass/fail | short result

## Inventory checks
- area | pass/fail | notes

## Remaining risks
- ...
\`\`\`

List every conflict. If there were none, say so explicitly. End by asking the user whether they approve pushing upstream, ksg/passthrough, and ksg/dev. Do not push unless the user explicitly approves in a later message.`;
}

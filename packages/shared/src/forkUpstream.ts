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

Read AGENTS.md, docs/operations/ksg-fork.md, and docs/operations/ksg-customization-inventory.md before running any merge. Work only in this KSG repository and its sync worktrees. Do not use GitHub's "Sync fork", git rebase, or a force push. Never install an upstream artifact over KSG. This task ends with a local sync report. A push, release, or device update requires separate explicit user approval.

## 1. Preflight

Run these commands from the KSG repository root. Run one command at a time and stop on failure.

\`\`\`sh
git config rerere.enabled true
git config rerere.autoupdate false
git fetch origin
git fetch --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/upstream/v*'
tag="${tag}"
published_tag="$(gh api "repos/${T3_UPSTREAM_REPOSITORY}/releases/tags/$tag" --jq 'select(.draft == false and .published_at != null) | .tag_name')"
test "$published_tag" = "$tag"
upstream_ref="refs/tags/upstream/$tag"
git rev-parse --verify "$upstream_ref^{commit}"
git worktree list
git status --short --branch
\`\`\`

The selected tag is exactly ${tag}. Do not substitute upstream main, another nightly, or a tag outside refs/tags/upstream/*. Record the verified commit. Before merging, run git status in every worktree you will use. Stop if the release is unpublished, the tag or a required branch is missing, a worktree is dirty, or a Git operation is in progress.

The upstream, ksg/passthrough, and ksg/dev branches may already be checked out in separate worktrees. Use git worktree list to find them. If a branch has its own worktree, run that branch's merge commands there. Never force-move or switch a branch out from under another worktree.

## 2. Merge forward, merges only

Run the three layers in order. If a branch already has a worktree, change to that worktree and omit its git switch command. Run each command separately. The mirror must end at the exact verified commit:

\`\`\`sh
git switch upstream
upstream_ref="refs/tags/upstream/${tag}"
git merge-base --is-ancestor HEAD "$upstream_ref"
git merge-base --is-ancestor origin/upstream "$upstream_ref"
git merge --ff-only origin/upstream
git merge --ff-only "$upstream_ref"
test "$(git rev-parse HEAD)" = "$(git rev-parse "$upstream_ref^{commit}")"
\`\`\`

\`\`\`sh
git switch ksg/passthrough
git merge --ff-only origin/ksg/passthrough
git merge --no-edit upstream
\`\`\`

\`\`\`sh
git switch ksg/dev
git merge --ff-only origin/ksg/dev
git merge --no-edit ksg/passthrough
vp i
\`\`\`

If an ancestry or fast-forward check fails, stop and report the branch. If a layer merge conflicts, resolve it using step 3 and finish that merge before running the next layer. Review git diff upstream ksg/passthrough after the passthrough merge and git diff ksg/passthrough ksg/dev after the dev merge, even when Git reported no conflicts. Apply the migration rule in step 3 before running the dev checks, including when Git merged the migration files cleanly.

## 3. Resolve conflicts by preserving KSG intent

When a merge stops with conflicts, run git status --short and keep the complete conflict list for the final report. For every conflicted path:

1. Find the owning area in docs/operations/ksg-customization-inventory.md.
2. Inspect both sides against the merge base. For an unmerged path, use git diff --cc -- <path> and git show :1:<path>, :2:<path>, and :3:<path> for the base, current branch, and incoming versions that exist.
3. Preserve the inventory behavior and the intent of the KSG patch. Upstream wins only outside that intent.
4. If upstream moved the code, reapply the KSG behavior at the new location. Never drop a KSG patch merely to make the conflict disappear.
5. KSG databases already recorded Captain migrations 112 through 115. Add four to every newly integrated upstream migration ID 112 or higher in the filename and manifest entry, including its import. Leave all previously shipped KSG migration IDs and files intact. Check this even when the migration files and manifest merge cleanly.
6. For a modify/delete conflict, do not choose deletion or restoration by reflex. If KSG deleted the file, find its replacement, port upstream's behavior fix there, and delete only when the replacement already covers it. If upstream deleted the file, accept deletion only after identifying the replacement or proving the file is obsolete.
7. For generated translation catalog conflicts, finish the source-code conflicts first. If the generator is unavailable, resolve package manifests and the lockfile before running \`vp i\`. Start from valid catalog JSON, then run \`vp run i18n:generate\` in each affected app (web, mobile, or desktop) and stage the generated catalogs. Review the result for lost translations. Do not hand-merge generated keys. See docs/internals/14_i18n.md.
8. For \`apps/server/src/provider/agentContextBudget.json\`, keep upstream's \`codexAdditionalContextBytes\` and preserve KSG's larger \`mcpToolListJsonBytes\` unless the Captain MCP tool manifest changed enough to require recalibration. Record the numbers in the report.
9. Stop with MERGE BLOCKED for a modify/delete conflict without a proven replacement or reason for deletion, a semantic conflict in ThreadRouteScreen.tsx or the mobile Duet code it uses, or a multi-hunk file where you cannot explain each hunk and how they work together. Use the same stop for any uncertain resolution. Leave the path unresolved, name the choices, and ask for a decision.

Stage each resolved path. Run git diff --name-only --diff-filter=U and git diff --cached --check. Once no unmerged paths remain and the staged diff passes, inspect it and finish with git merge --continue.

## 4. Required checks before reporting success

Run the inventory's check commands. Run focused tests for every affected area and the typecheck for every affected package. Examples:

\`\`\`sh
vp test run packages/shared/src/forkUpstream.test.ts
(cd apps/web && vp run typecheck)
vp run i18n:check
\`\`\`

Use both layer diffs and the conflict list to choose additional focused tests, such as Captain, layout, sidebar, pull request, provider, usage, release, or migration tests. If a check fails, fix the merge and rerun it. If you cannot fix it without ambiguity, stop and report the failing command and output. Do not claim success with a failing or skipped required check.

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

List every conflict. If there were none, say so explicitly. If blocked, report the current heads and pending checks, then ask only for the decision needed to proceed. After a successful local sync, ask the user whether they approve pushing upstream, ksg/passthrough, and ksg/dev. Do not push unless the user explicitly approves in a later message.`;
}

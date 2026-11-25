import { msg } from "gt-react";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import {
  replaceThreadLinks,
  threadLinkCandidates,
  threadLinkRefs,
} from "@t3tools/shared/threadLinks";

import { m, type MessageResolver } from "../../i18n/messages";
import { formatShortTimestamp } from "../../timestampFormat";

export type DuetStreamKind = "channel" | "editorial";

const DUET_TIMESTAMP_GAP_MS = 15 * 60_000;

type TimelineRowLike = {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string | null;
  readonly message?: {
    readonly role: string;
    readonly text: string;
  };
};

/** Rows that open a centered timestamp: the first message, then messages over fifteen minutes apart. */
export function duetTimestampDividers(
  rows: ReadonlyArray<TimelineRowLike>,
  gapMs = DUET_TIMESTAMP_GAP_MS,
): ReadonlyMap<string, string> {
  const dividers = new Map<string, string>();
  let previousMs: number | null = null;
  for (const row of rows) {
    if (row.kind !== "message" || row.message === undefined) continue;
    if (row.createdAt === null) continue;
    const createdMs = Date.parse(row.createdAt);
    if (Number.isNaN(createdMs)) continue;
    if (previousMs === null || createdMs - previousMs > gapMs) {
      dividers.set(row.id, row.createdAt);
    }
    previousMs = createdMs;
  }
  return dividers;
}

const sameCalendarDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

/** The centered stream divider's compact, day-aware form. */
export function formatDuetTimestampDivider(
  isoDate: string,
  timestampFormat: TimestampFormat,
  nowMs = Date.now(),
  resolve: MessageResolver = m,
): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const time = formatShortTimestamp(isoDate, timestampFormat);
  const now = new Date(nowMs);
  if (sameCalendarDay(date, now)) return resolve(msg("Today {time}", { time }));
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return resolve(msg("Yesterday {time}", { time }));
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  return `${day} ${time}`;
}

const scopedKey = (ref: ScopedThreadRef) => `${ref.environmentId}\0${ref.threadId}`;

/** The first Captain child thread an assistant message links to, when it links to one. */
function duetTaskThreadLink(
  markdown: string,
  captainRef: ScopedThreadRef,
  childThreadIds: ReadonlySet<ThreadId>,
): ThreadId | null {
  for (const ref of threadLinkRefs(markdown, captainRef.environmentId)) {
    if (
      ref.environmentId === captainRef.environmentId &&
      ref.threadId !== captainRef.threadId &&
      childThreadIds.has(ref.threadId)
    ) {
      return ref.threadId;
    }
  }
  return null;
}

/**
 * Assistant rows that open a task context header. A repeated link stays in the same group; the
 * header returns when the first linked child changes.
 */
export function duetTaskHeaderByRowId(
  rows: ReadonlyArray<TimelineRowLike>,
  captainRef: ScopedThreadRef,
  childThreadIds: ReadonlySet<ThreadId>,
): ReadonlyMap<string, ThreadId> {
  const headers = new Map<string, ThreadId>();
  let previous: ThreadId | null = null;
  for (const row of rows) {
    if (row.kind !== "message" || row.message?.role !== "assistant") continue;
    const linked = duetTaskThreadLink(row.message.text, captainRef, childThreadIds);
    if (linked === null) continue;
    if (linked !== previous) headers.set(row.id, linked);
    previous = linked;
  }
  return headers;
}

/** The fragment href a Duet inline thread link uses before the row intercepts its click. */
function duetInlineThreadHref(ref: ScopedThreadRef): string {
  return `#duet-thread/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`;
}

export function parseDuetInlineThreadHref(href: string): ScopedThreadRef | null {
  const match = /^#duet-thread\/([^/]+)\/([^/]+)$/.exec(href);
  if (!match) return null;
  try {
    return {
      environmentId: EnvironmentId.make(decodeURIComponent(match[1]!)),
      threadId: ThreadId.make(decodeURIComponent(match[2]!)),
    };
  } catch {
    return null;
  }
}

const markdownLabel = (label: string) =>
  label
    .replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Rewrites thread links as ordinary inline links for the channel stream. Their click is handled
 * by the assistant bubble, so they never become chips inside a Duet reply.
 */
export function inlineDuetThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  titleByThreadKey: ReadonlyMap<string, string>,
  resolve: MessageResolver = m,
): string {
  return replaceThreadLinks(markdown, (link, writtenLabel) => {
    const ref = threadLinkCandidates(link, messageEnvironmentId)[0];
    if (!ref) return undefined;
    const title =
      (writtenLabel ? markdownLabel(writtenLabel) : "") ||
      titleByThreadKey.get(scopedKey(ref)) ||
      resolve(msg("Thread"));
    return `[○ ${markdownLabel(title) || resolve(msg("Thread"))}](${duetInlineThreadHref(ref)})`;
  });
}

const DUET_CAPTAIN_DOCUMENT_NAMES = ["DIGEST.md", "NOTES.md", "AGENTS.md", "CREW.md"] as const;
export type DuetCaptainDocumentName = (typeof DUET_CAPTAIN_DOCUMENT_NAMES)[number];

export interface DuetDocumentReference {
  readonly key: string;
  readonly title: string;
  readonly extension: string;
  readonly href: string | null;
  readonly captainDocumentName: DuetCaptainDocumentName | null;
  readonly action: "open" | "download";
}

const captainDocumentName = (name: string): DuetCaptainDocumentName | null =>
  (DUET_CAPTAIN_DOCUMENT_NAMES as ReadonlyArray<string>).includes(name)
    ? (name as DuetCaptainDocumentName)
    : null;

const fileNameOf = (value: string) => {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const decoded = (() => {
    try {
      return decodeURIComponent(withoutQuery);
    } catch {
      return withoutQuery;
    }
  })();
  const normalized = decoded.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

function documentReference(
  source: string,
  href: string | null,
  key: string,
): DuetDocumentReference | null {
  const title = fileNameOf(source).trim();
  const captainName = captainDocumentName(title);
  const extension = title.includes(".") ? (title.split(".").pop()?.toLowerCase() ?? "") : "";
  if (captainName === null && extension !== "md" && extension !== "html") return null;
  return {
    key,
    title,
    extension,
    href,
    captainDocumentName: captainName,
    action: "open",
  };
}

// A web or mail link points off the workspace and stays an ordinary link.
const hasUrlScheme = (value: string) => /^(?:https?|mailto):/i.test(value);
const FENCE_LINE = /^[ \t]{0,3}(?:```|~~~)/gm;

function parseStandaloneDocumentParagraph(
  paragraph: string,
  key: string,
): DuetDocumentReference | null {
  const trimmed = paragraph.trim();
  const link = /^\[([^\]\n]+)\]\((?:<([^<>\n]+)>|([^\s)\n]+))(?:\s+["'][^"'\n]*["'])?\)$/.exec(
    trimmed,
  );
  if (link) {
    const label = link[1]!;
    const href = link[2] ?? link[3] ?? null;
    if (href !== null && hasUrlScheme(href)) return null;
    return documentReference(label, href, key) ?? documentReference(href ?? "", href, key);
  }
  if (!hasUrlScheme(trimmed) && /^[^\s[\]()]+\.(?:md|html)$/i.test(trimmed)) {
    return documentReference(trimmed, trimmed, key);
  }
  const bareCaptain = captainDocumentName(trimmed);
  return bareCaptain === null ? null : documentReference(trimmed, null, key);
}

/**
 * Standalone document paragraphs become cards in the channel stream. The paragraphs are removed
 * from the markdown so a card does not repeat its own one-line link.
 */
export function extractDuetDocumentCards(markdown: string): {
  readonly text: string;
  readonly documents: ReadonlyArray<DuetDocumentReference>;
} {
  const pieces = markdown.split(/(\n[ \t]*\n+)/);
  const kept: string[] = [];
  const documents: DuetDocumentReference[] = [];
  let inFence = false;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (index % 2 === 1) {
      kept.push(piece);
      continue;
    }
    const fences = piece.match(FENCE_LINE)?.length ?? 0;
    const insideCode = inFence || fences > 0;
    if (fences % 2 === 1) inFence = !inFence;
    if (insideCode) {
      kept.push(piece);
      continue;
    }
    const reference = parseStandaloneDocumentParagraph(piece, `document-${documents.length}`);
    if (reference === null) {
      kept.push(piece);
    } else {
      documents.push(reference);
    }
  }
  return {
    text: kept
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    documents,
  };
}

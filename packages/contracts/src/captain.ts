import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2CreationSource } from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const CaptainId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("CaptainId"),
);
export type CaptainId = typeof CaptainId.Type;

export const captainPrimaryThreadId = (id: CaptainId, ordinal: number): ThreadId =>
  ThreadId.make(`captain:${id}:${ordinal}`);

export const isCaptainThreadId = (id: ThreadId): boolean => id.startsWith("captain:");

export const CaptainMemoryId = TrimmedNonEmptyString.check(Schema.isMaxLength(128)).pipe(
  Schema.brand("CaptainMemoryId"),
);
export type CaptainMemoryId = typeof CaptainMemoryId.Type;

const captainAvatarPickerShapeLiterals = [
  "circle",
  "cloud",
  "diamond",
  "sparkle",
  "clover",
  "pebble",
  "flower",
  "drop",
  "pill",
  "triangle",
  "pentagon",
  "gear",
  "hexagon",
] as const;
export const CaptainAvatarPickerShape = Schema.Literals(captainAvatarPickerShapeLiterals);
export type CaptainAvatarPickerShape = typeof CaptainAvatarPickerShape.Type;
export const CaptainAvatarShape = Schema.Literals([
  ...captainAvatarPickerShapeLiterals,
  "squircle",
]);
export type CaptainAvatarShape = typeof CaptainAvatarShape.Type;
// The icon presets predate shapes and stay readable for Captains saved with them.
export const CaptainAvatarPreset = Schema.Union([
  CaptainAvatarShape,
  Schema.Literals(["compass", "mountain", "terminal", "flag"]),
]);
const captainAvatarPickerColorLiterals = [
  "black",
  "brown",
  "red",
  "tangerine",
  "orange",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;
export const CaptainAvatarPickerColor = Schema.Literals(captainAvatarPickerColorLiterals);
export type CaptainAvatarPickerColor = typeof CaptainAvatarPickerColor.Type;
export const CaptainAvatarColor = Schema.Literals([
  ...captainAvatarPickerColorLiterals,
  "ink",
  "violet",
  "emerald",
  "amber",
  "rose",
]);
export const CaptainAvatar = Schema.Struct({
  preset: CaptainAvatarPreset,
  color: CaptainAvatarColor,
  // Older clients decode color as a closed set and drop this optional palette id.
  palette: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32))),
});
export type CaptainAvatar = typeof CaptainAvatar.Type;

export const CaptainReportPolicy = Schema.Literals(["react", "context", "ignore"]);
export type CaptainReportPolicy = typeof CaptainReportPolicy.Type;

export const CaptainKind = Schema.Literals(["duet", "chorus"]);
export type CaptainKind = typeof CaptainKind.Type;

export const CaptainConversationEndReason = Schema.Literals([
  "manual",
  "context_overflow",
  "compaction_failed",
  "threshold",
]);
export type CaptainConversationEndReason = typeof CaptainConversationEndReason.Type;

/** Reasons align by index with `earlierThreadIds`; absent entries predate reasons and are manual. */
export const captainEarlierConversations = (
  captain: Pick<Captain, "earlierThreadIds" | "earlierThreadEndReasons">,
) =>
  captain.earlierThreadIds.map((threadId, index) => ({
    threadId,
    endReason: captain.earlierThreadEndReasons?.[index] ?? ("manual" as const),
  }));

const CaptainProfile = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  role: Schema.String.check(Schema.isMaxLength(120)),
  instructions: Schema.String.check(Schema.isMaxLength(16_000)),
  avatar: CaptainAvatar,
  scopedProjectIds: Schema.Array(ProjectId),
  reportPolicy: CaptainReportPolicy,
});

export const Captain = Schema.Struct({
  ...CaptainProfile.fields,
  // Absent from servers older than the coordinator setting.
  coordinatorOnly: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  // Absent from servers older than Chorus.
  kind: CaptainKind.pipe(Schema.withDecodingDefaultKey(Effect.succeed("duet"))),
  id: CaptainId,
  primaryThreadId: ThreadId,
  earlierThreadIds: Schema.Array(ThreadId),
  earlierThreadEndReasons: Schema.optionalKey(Schema.Array(CaptainConversationEndReason)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type Captain = typeof Captain.Type;

export const CaptainDocumentName = Schema.Literals([
  "NOTES.md",
  "AGENTS.md",
  "CREW.md",
  "DIGEST.md",
]);
export type CaptainDocumentName = typeof CaptainDocumentName.Type;

export const CaptainDocumentContent = Schema.String.check(Schema.isMaxLength(64_000));
export const CaptainDocumentRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const CaptainDocument = Schema.Struct({
  captainId: CaptainId,
  name: CaptainDocumentName,
  content: CaptainDocumentContent,
  revision: CaptainDocumentRevision,
  updatedAt: IsoDateTime,
});
export type CaptainDocument = typeof CaptainDocument.Type;

export const CaptainMemoryText = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));
export const CaptainMemory = Schema.Struct({
  id: CaptainMemoryId,
  captainId: CaptainId,
  text: CaptainMemoryText,
  essential: Schema.Boolean,
  userControlled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CaptainMemory = typeof CaptainMemory.Type;

export const CaptainSnapshot = Schema.Struct({
  captains: Schema.Array(Captain),
  documents: Schema.Array(CaptainDocument),
  memories: Schema.Array(CaptainMemory),
});
export type CaptainSnapshot = typeof CaptainSnapshot.Type;

export const FleetChorusHome = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  threadId: Schema.NullOr(ThreadId),
});
export type FleetChorusHome = typeof FleetChorusHome.Type;

export const FleetChorusState = Schema.Literals([
  "ready",
  "offline",
  "too_old",
  "unconfigured",
  "setting_up",
  "conflict",
]);
export type FleetChorusState = typeof FleetChorusState.Type;

/** The fleet's one Chorus as the environment the client connected to knows it. */
export const FleetChorusStatus = Schema.Struct({
  state: FleetChorusState,
  home: Schema.NullOr(FleetChorusHome),
  /** This environment's own Chorus home switch. */
  localHome: Schema.Boolean,
  /** Other machines currently claiming the home, when a conflict is visible. */
  conflictingHomes: Schema.Array(Schema.String),
  updatedAt: IsoDateTime,
});
export type FleetChorusStatus = typeof FleetChorusStatus.Type;

export const CaptainSubscribeInput = Schema.Struct({
  captainId: Schema.optionalKey(CaptainId),
});
export type CaptainSubscribeInput = typeof CaptainSubscribeInput.Type;

export const CaptainKey = Schema.Struct({ captainId: CaptainId });

export const CaptainCreateInput = Schema.Struct({
  ...CaptainProfile.fields,
  coordinatorOnly: Schema.optional(Schema.Boolean),
  kind: Schema.optional(CaptainKind),
  captainId: CaptainId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type CaptainCreateInput = typeof CaptainCreateInput.Type;

export const CaptainUpdateInput = Schema.Struct({
  ...CaptainKey.fields,
  name: Schema.optional(CaptainProfile.fields.name),
  role: Schema.optional(CaptainProfile.fields.role),
  instructions: Schema.optional(CaptainProfile.fields.instructions),
  avatar: Schema.optional(CaptainAvatar),
  scopedProjectIds: Schema.optional(CaptainProfile.fields.scopedProjectIds),
  reportPolicy: Schema.optional(CaptainReportPolicy),
  coordinatorOnly: Schema.optional(Schema.Boolean),
});
export type CaptainUpdateInput = typeof CaptainUpdateInput.Type;

export const CaptainResetInput = Schema.Struct({
  ...CaptainKey.fields,
  expectedThreadId: ThreadId,
  reason: Schema.optionalKey(CaptainConversationEndReason),
});
export type CaptainResetInput = typeof CaptainResetInput.Type;

export const CaptainUpdateDocumentInput = Schema.Struct({
  ...CaptainKey.fields,
  name: CaptainDocumentName,
  content: CaptainDocumentContent,
  expectedRevision: CaptainDocumentRevision,
});
export type CaptainUpdateDocumentInput = typeof CaptainUpdateDocumentInput.Type;

export const CaptainUpsertMemoryInput = Schema.Struct({
  ...CaptainKey.fields,
  id: CaptainMemoryId,
  text: CaptainMemoryText,
  essential: Schema.Boolean,
});
export type CaptainUpsertMemoryInput = typeof CaptainUpsertMemoryInput.Type;

export const CaptainDeleteMemoryInput = Schema.Struct({
  ...CaptainKey.fields,
  id: CaptainMemoryId,
});
export type CaptainDeleteMemoryInput = typeof CaptainDeleteMemoryInput.Type;

export class CaptainError extends Schema.TaggedError<CaptainError>()("CaptainError", {
  code: Schema.Literals(["not_found", "invalid_request", "conflict", "locked", "unavailable"]),
  message: Schema.String,
}) {}

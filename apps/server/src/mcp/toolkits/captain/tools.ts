import {
  Captain,
  CaptainDocument,
  CaptainId,
  CaptainKind,
  CaptainDocumentContent,
  CaptainDocumentName,
  CaptainDocumentRevision,
  CaptainMemory,
  CaptainMemoryId,
  CaptainMemoryText,
  EnvironmentId,
  MessageId,
  OrchestratorMcpFailure,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const options = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext],
};

const writeOptions = {
  ...options,
  dependencies: [...options.dependencies, ThreadManagement.ThreadManagementService],
};

const DuetEnvironment = Schema.Struct({
  environmentId: EnvironmentId,
  environmentLabel: Schema.String,
});

const DuetListEntry = Schema.Struct({
  ...DuetEnvironment.fields,
  id: CaptainId,
  name: Schema.String,
  role: Schema.String,
  kind: CaptainKind,
  scopedProjectTitles: Schema.Array(Schema.String),
  archived: Schema.Boolean,
  primaryThreadId: ThreadId,
  digestNew: Schema.Array(Schema.String),
});

const DuetReadPayload = Schema.Union([
  Schema.Struct({ profile: Captain }),
  Schema.Struct({ document: CaptainDocument, truncated: Schema.Boolean }),
]);

const DuetEnvironmentTarget = Schema.optional(
  EnvironmentId.annotate({
    description: "Linked machine to read or act in. Omit to fan out across the fleet.",
  }),
);

const UnreachableMachine = Schema.Struct({
  environmentId: EnvironmentId,
  environmentLabel: Schema.String,
  reason: Schema.String.check(Schema.isMaxLength(300)),
});

const DuetReadResult = Schema.Union([
  DuetReadPayload,
  Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        ...DuetEnvironment.fields,
        result: DuetReadPayload,
      }),
    ),
    unreachableMachines: Schema.optional(Schema.Array(UnreachableMachine)),
  }),
]);

const DuetMemorySearchResult = Schema.Struct({
  matches: Schema.Array(
    Schema.Struct({
      ...DuetEnvironment.fields,
      source: Schema.Literals(["local", "honcho"]),
      duet: Schema.Struct({ id: CaptainId, name: Schema.String }),
      memory: CaptainMemory,
    }),
  ),
  unreachableMachines: Schema.optional(Schema.Array(UnreachableMachine)),
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(160))),
});

export const CaptainToolkit = Toolkit.make(
  Tool.make("duet_list", {
    ...options,
    description:
      "List Duets across the fleet, including archived ones, with machine, role, kind, workspace scope titles, current primary thread, and the first lines of DIGEST.md's ## New section. Omit environmentId for every linked machine; unreachable machines are reported without failing the call. Use this first for cross-Duet questions. Read-only: it changes nothing and sends nothing.",
    parameters: Schema.Struct({ environmentId: DuetEnvironmentTarget }),
    success: Schema.Struct({
      duets: Schema.Array(DuetListEntry),
      unreachableMachines: Schema.optional(Schema.Array(UnreachableMachine)),
    }),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpInvocationContext.ListedWhen, McpInvocationContext.chorusOnly),
  Tool.make("duet_read", {
    ...options,
    description:
      "Read one Duet's profile, or one of its NOTES.md, AGENTS.md, CREW.md, or DIGEST.md documents with its revision, across the fleet when environmentId is omitted. Document content is capped at 16,000 characters and marked when truncated. Read-only: it changes nothing and sends nothing.",
    parameters: Schema.Struct({
      duetId: CaptainId,
      environmentId: DuetEnvironmentTarget,
      document: Schema.optional(CaptainDocumentName),
    }),
    success: DuetReadResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpInvocationContext.ListedWhen, McpInvocationContext.chorusOnly),
  Tool.make("duet_memory_search", {
    ...options,
    description:
      "Search local memories and long-term recall across every Duet on each machine, or omit query for recent memories. Narrow with duetId or environmentId. Results are labelled by machine, Duet, and source; each machine contributes at most 20 matches. Read-only: it changes nothing and sends nothing.",
    parameters: Schema.Struct({
      query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
      duetId: Schema.optional(CaptainId),
      environmentId: DuetEnvironmentTarget,
    }),
    success: DuetMemorySearchResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpInvocationContext.ListedWhen, McpInvocationContext.chorusOnly),
  Tool.make("duet_send", {
    ...options,
    description:
      "Route the user's work request to a Duet's current conversation on its machine. For questions, use duet_list or duet_read. Confirm the route with the returned thread link. The result appears the next time the user messages Chorus.",
    parameters: Schema.Struct({
      duetId: CaptainId,
      environmentId: DuetEnvironmentTarget,
      message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100000)),
      mode: Schema.optional(Schema.Literals(["auto", "queue", "steer", "restart"])),
      clientRequestId: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({
      duetId: CaptainId,
      environmentId: EnvironmentId,
      threadId: ThreadId,
      link: Schema.String,
      messageId: MessageId,
      runId: RunId,
      taskId: Schema.optional(Schema.String),
      status: Schema.String,
      delivery: Schema.String,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return" as const,
    dependencies: [...writeOptions.dependencies, OrchestratorMcpService.OrchestratorMcpService],
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly)
    .annotate(McpInvocationContext.ListedWhen, McpInvocationContext.chorusOnly),
  Tool.make("captain_read", {
    ...options,
    description: "Read your Duet profile, workspace scope and report policy.",
    success: Captain,
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
  Tool.make("captain_document_read", {
    ...options,
    description: "Read one of your Duet documents and its current revision.",
    parameters: Schema.Struct({ name: CaptainDocumentName }),
    success: CaptainDocument,
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
  Tool.make("captain_document_write", {
    ...writeOptions,
    description:
      "Replace one of your Duet documents. Use the revision from captain_document_read. On conflict, read the latest copy and reconcile your changes.",
    parameters: Schema.Struct({
      name: CaptainDocumentName,
      content: CaptainDocumentContent,
      expectedRevision: CaptainDocumentRevision,
    }),
    success: CaptainDocument,
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
  Tool.make("captain_memory_remember", {
    ...writeOptions,
    description:
      "Save a durable memory for your Duet. Omit id to add a memory. Use essential for information needed on every turn. User-controlled memories are locked.",
    parameters: Schema.Struct({
      id: Schema.optional(CaptainMemoryId),
      text: CaptainMemoryText,
      essential: Schema.optional(Schema.Boolean),
    }),
    success: CaptainMemory,
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
  Tool.make("captain_memory_forget", {
    ...writeOptions,
    description: "Delete one of your Duet's memories by id. User-controlled memories are locked.",
    parameters: Schema.Struct({ id: CaptainMemoryId }),
    success: Schema.Struct({ id: CaptainMemoryId }),
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
  Tool.make("captain_memory_search", {
    ...options,
    description:
      "Search your Duet's memories by text, or omit query to list recent memories. When long-term memory is enabled, recalled matches follow local memories and start with 'Recalled:'.",
    parameters: Schema.Struct({
      query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
    }),
    success: Schema.Struct({ memories: Schema.Array(CaptainMemory) }),
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.captainOnly),
);

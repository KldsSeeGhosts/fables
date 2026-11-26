import {
  Captain,
  CaptainDocument,
  CaptainDocumentContent,
  CaptainDocumentName,
  CaptainDocumentRevision,
  CaptainMemory,
  CaptainMemoryId,
  CaptainMemoryText,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
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

export const CaptainToolkit = Toolkit.make(
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

import { assert, it } from "@effect/vitest";
import {
  CaptainError,
  CaptainId,
  captainPrimaryThreadId,
  ProviderInstanceId,
  type Captain,
  type CaptainDocument,
  type CaptainDocumentName,
  type CaptainUpdateDocumentInput,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CaptainBriefService from "./CaptainBriefService.ts";
import * as CaptainStore from "./CaptainStore.ts";

const captain: Captain = {
  id: CaptainId.make("maria"),
  name: "Maria",
  role: "Coordinator",
  instructions: "Keep the brief useful.",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "context",
  coordinatorOnly: false,
  kind: "duet",
  primaryThreadId: captainPrimaryThreadId(CaptainId.make("maria"), 0),
  earlierThreadIds: [],
  createdAt: "2026-11-25T08:00:00.000Z",
  updatedAt: "2026-11-25T08:00:00.000Z",
  archivedAt: null,
};

const digestContent = `# Maria digest

## New

- stale item

## Projects

Keep this section exactly.\n\n\nThis blank spacing stays.

## Decisions

Keep this too.
`;

const makeCaptain = (id: CaptainId, name: string, overrides: Partial<Captain> = {}): Captain => ({
  ...captain,
  id,
  name,
  primaryThreadId: captainPrimaryThreadId(id, 0),
  ...overrides,
});

const documentFor = (
  owner: Captain,
  name: CaptainDocumentName,
  content: string,
  revision = 0,
): CaptainDocument => ({
  captainId: owner.id,
  name,
  content,
  revision,
  updatedAt: "2026-11-25T08:00:00.000Z",
});

const document = (name: CaptainDocumentName, content: string, revision = 0): CaptainDocument =>
  documentFor(captain, name, content, revision);

it("replaces only the digest New section", () => {
  const next = CaptainBriefService.replaceCaptainDigestNewSection(
    digestContent,
    "- fresh item\n- second item",
  );
  assert.isTrue(next.includes("## New\n\n- fresh item\n- second item"));
  assert.isTrue(
    next.includes("## Projects\n\nKeep this section exactly.\n\n\nThis blank spacing stays."),
  );
  assert.isTrue(next.endsWith("## Decisions\n\nKeep this too.\n"));
  assert.isFalse(next.includes("stale item"));
});

it("adds a missing New section after the digest title", () => {
  const next = CaptainBriefService.replaceCaptainDigestNewSection(
    "# Maria digest\n\n## Projects\n\nKeep this section.",
    "- fresh item",
  );
  assert.equal(
    next,
    "# Maria digest\n\n## New\n\n- fresh item\n\n## Projects\n\nKeep this section.",
  );
  assert.equal(
    CaptainBriefService.replaceCaptainDigestNewSection("\n## Projects\r\n\r\nKeep this.\r\n", ""),
    "## New\n\n\n## Projects\r\n\r\nKeep this.\r\n",
  );
});

it.effect("generates with the brief model and retries once after a revision conflict", () =>
  Effect.gen(function* () {
    const textModel = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-luna");
    const briefModel = createModelSelection(ProviderInstanceId.make("claudeAgent"), "claude-haiku");
    const generationModels: unknown[] = [];
    const generationPrompts: string[] = [];
    const documents = new Map<CaptainDocumentName, CaptainDocument>([
      ["NOTES.md", document("NOTES.md", `User cares about the migration.\n${"x".repeat(50_000)}`)],
      ["DIGEST.md", document("DIGEST.md", digestContent)],
    ]);
    let digestReads = 0;
    let writes = 0;
    let response = Effect.succeed({ text: "- migration finished\n- one approval waits" });
    const storeLayer = Layer.mock(CaptainStore.CaptainStore)({
      find: (id) => Effect.succeed(id === captain.id ? captain : undefined),
      document: (_captain, name) =>
        Effect.sync(() => {
          if (name === "DIGEST.md") digestReads++;
          return documents.get(name) ?? document(name, "");
        }),
      updateDocument: (input) => {
        writes++;
        if (writes === 1) {
          documents.set(
            "DIGEST.md",
            document("DIGEST.md", `${digestContent}\nConcurrent edit.\n`, 1),
          );
          return Effect.fail(
            new CaptainError({
              code: "conflict",
              message: "This document changed. Load the latest revision before saving.",
            }),
          );
        }
        const current = documents.get(input.name) ?? document(input.name, "");
        if (current.revision !== input.expectedRevision) {
          return Effect.fail(
            new CaptainError({
              code: "conflict",
              message: "This document changed. Load the latest revision before saving.",
            }),
          );
        }
        return Effect.sync(() => {
          const updated = { ...current, content: input.content, revision: current.revision + 1 };
          documents.set(input.name, updated);
          return updated;
        });
      },
    });
    const textGenerationLayer = Layer.mock(TextGeneration.TextGeneration)({
      generateBriefText: (input) =>
        Effect.suspend(() => {
          generationModels.push(input.modelSelection);
          generationPrompts.push(input.prompt);
          return response;
        }),
    });
    const layer = CaptainBriefService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          storeLayer,
          textGenerationLayer,
          ServerSettings.layerTest({
            textGenerationModelSelection: textModel,
            briefModelSelection: briefModel,
          }),
        ),
      ),
      Layer.provideMerge(Sqlite.layerMemory),
    );

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const completedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          child_thread_id, started_at, completed_at, updated_at, payload_json
        ) VALUES ('task-1', ${captain.primaryThreadId}, 'node', 'codex', 'app_owned', 'completed',
          'thread:child', ${completedAt}, ${completedAt}, ${completedAt}, ${JSON.stringify({
            title: "Review the migration",
            result: "Migration review passed",
          })})
      `.pipe(Effect.orDie);
      const service = yield* CaptainBriefService.CaptainBriefService;
      const written = yield* service.generate({ captainId: captain.id });
      assert.equal(writes, 2);
      assert.isTrue(digestReads >= 3);
      assert.deepEqual(generationModels, [briefModel]);
      assert.isTrue(written.content.includes("- migration finished"));
      assert.isTrue(generationPrompts[0]?.includes("Review the migration") === true);
      assert.isTrue(generationPrompts[0]?.includes("Migration review passed") === true);
      assert.isTrue(generationPrompts[0]?.includes("Cover progress, open work, blockers") === true);
      assert.isFalse(generationPrompts[0]?.includes("Group items by Duet"));
      assert.isBelow(generationPrompts[0]!.length, 16_000);
      assert.isTrue(written.content.endsWith("\nConcurrent edit.\n"));
      assert.isTrue(
        written.content.includes(
          "## Projects\n\nKeep this section exactly.\n\n\nThis blank spacing stays.",
        ),
      );

      response = Effect.succeed({ text: "- item\n\n## Decisions\nDuplicate section." });
      const malformed = yield* Effect.result(service.generate({ captainId: captain.id }));
      assert.equal(malformed._tag, "Failure");
      assert.equal(writes, 2);

      documents.set(
        "DIGEST.md",
        document("DIGEST.md", `## New\n\n## Projects\n${"x".repeat(63_970)}`, 3),
      );
      response = Effect.succeed({ text: "- ".concat("An item to review. ".repeat(10)) });
      const oversized = yield* Effect.result(service.generate({ captainId: captain.id }));
      assert.equal(oversized._tag, "Failure");
      assert.equal(writes, 2);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("builds a Chorus brief from every active Duet without writing their documents", () =>
  Effect.gen(function* () {
    const chorus = makeCaptain(CaptainId.make("chorus"), "Chorus", {
      kind: "chorus",
      coordinatorOnly: true,
      reportPolicy: "react",
    });
    const alpha = makeCaptain(CaptainId.make("alpha"), "Alpha");
    const beta = makeCaptain(CaptainId.make("beta"), "Beta");
    const archived = makeCaptain(CaptainId.make("archived"), "Archived", {
      archivedAt: "2026-11-25T09:00:00.000Z",
    });
    const captains = [chorus, alpha, beta, archived];
    const documents = new Map<string, CaptainDocument>();
    const putDocument = (owner: Captain, name: CaptainDocumentName, content: string) =>
      documents.set(`${owner.id}:${name}`, documentFor(owner, name, content));
    putDocument(chorus, "NOTES.md", "The user wants fleet risks first.");
    putDocument(chorus, "DIGEST.md", "# Chorus digest\n\n## New\n\n- stale chorus item\n");
    putDocument(
      alpha,
      "DIGEST.md",
      "# Alpha digest\n\n## New\n\n- Alpha digest item due tomorrow\n\n## Projects\n\nAlpha project detail that stays out.\n",
    );
    putDocument(beta, "DIGEST.md", "# Beta digest\n\n## New\n\n- Beta digest item\n");
    putDocument(archived, "DIGEST.md", "# Archived digest\n\n## New\n\n- Archived digest item\n");

    const generationPrompts: string[] = [];
    const writes: CaptainUpdateDocumentInput[] = [];
    const storeLayer = Layer.mock(CaptainStore.CaptainStore)({
      find: (id) => Effect.succeed(id === chorus.id ? chorus : undefined),
      snapshot: () => Effect.succeed({ captains, documents: [], memories: [] }),
      document: (owner, name) =>
        Effect.succeed(documents.get(`${owner.id}:${name}`) ?? documentFor(owner, name, "")),
      updateDocument: (input) => {
        writes.push(input);
        return Effect.sync(() => {
          const current =
            documents.get(`${input.captainId}:${input.name}`) ??
            documentFor(chorus, input.name, "");
          const updated = { ...current, content: input.content, revision: current.revision + 1 };
          documents.set(`${input.captainId}:${input.name}`, updated);
          return updated;
        });
      },
    });
    const textGenerationLayer = Layer.mock(TextGeneration.TextGeneration)({
      generateBriefText: (input) =>
        Effect.sync(() => {
          generationPrompts.push(input.prompt);
          return { text: "- **Alpha:** Alpha digest item due tomorrow" };
        }),
    });
    const layer = CaptainBriefService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          storeLayer,
          textGenerationLayer,
          ServerSettings.layerTest({
            textGenerationModelSelection: createModelSelection(
              ProviderInstanceId.make("codex"),
              "gpt-6-luna",
            ),
            briefModelSelection: createModelSelection(
              ProviderInstanceId.make("claudeAgent"),
              "claude-haiku",
            ),
          }),
        ),
      ),
      Layer.provideMerge(Sqlite.layerMemory),
    );

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const at = "2026-11-25T10:00:00.000Z";
      const alphaChild = "thread:alpha-child";
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          child_thread_id, started_at, updated_at, payload_json
        ) VALUES ('alpha-task', ${alpha.primaryThreadId}, 'node', 'codex', 'app_owned', 'running',
          ${alphaChild}, ${at}, ${at}, ${JSON.stringify({
            title: "Alpha active solo",
            progress: "Checking the release",
          })})
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_runtime_requests (
          runtime_request_id, thread_id, node_id, kind, status, created_at, payload_json
        ) VALUES ('alpha-request', ${alphaChild}, 'node', 'command', 'pending', ${at}, '{}')
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
        ) VALUES ('alpha-item', ${alphaChild}, 1, 'approval_request', 'pending', ${at},
          ${JSON.stringify({ requestId: "alpha-request", prompt: "Approve the alpha release" })})
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          started_at, updated_at, payload_json
        ) VALUES ('beta-task', ${beta.primaryThreadId}, 'node', 'codex', 'app_owned', 'waiting',
          ${at}, ${at}, ${JSON.stringify({ title: "Beta active solo" })})
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_runtime_requests (
          runtime_request_id, thread_id, node_id, kind, status, created_at, payload_json
        ) VALUES ('beta-request', ${beta.primaryThreadId}, 'node', 'user_input', 'pending', ${at}, '{}')
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
        ) VALUES ('beta-item', ${beta.primaryThreadId}, 2, 'user_input_request', 'pending', ${at},
          ${JSON.stringify({
            requestId: "beta-request",
            questions: [{ question: "Answer the beta question" }],
          })})
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          started_at, updated_at, payload_json
        ) VALUES ('chorus-task', ${chorus.primaryThreadId}, 'node', 'codex', 'app_owned', 'running',
          ${at}, ${at}, ${JSON.stringify({ title: "Chorus own solo" })})
      `.pipe(Effect.orDie);
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          started_at, updated_at, payload_json
        ) VALUES ('archived-task', ${archived.primaryThreadId}, 'node', 'codex', 'app_owned', 'running',
          ${at}, ${at}, ${JSON.stringify({ title: "Archived active solo" })})
      `.pipe(Effect.orDie);

      const service = yield* CaptainBriefService.CaptainBriefService;
      const written = yield* service.generate({ captainId: chorus.id });
      assert.lengthOf(writes, 1);
      assert.equal(writes[0]?.captainId, chorus.id);
      assert.equal(writes[0]?.name, "DIGEST.md");
      assert.isTrue(written.content.includes("- **Alpha:** Alpha digest item due tomorrow"));

      const prompt = generationPrompts[0]!;
      assert.include(prompt, "Group items by Duet");
      assert.include(prompt, "nearest deadline first");
      assert.include(prompt, "### Duet: Alpha");
      assert.include(prompt, "### Duet: Beta");
      assert.include(prompt, "Alpha digest item due tomorrow");
      assert.include(prompt, "Beta digest item");
      assert.include(prompt, "Alpha active solo");
      assert.include(prompt, "Beta active solo");
      assert.include(prompt, "Approve the alpha release");
      assert.include(prompt, "Answer the beta question");
      assert.notInclude(prompt, "Chorus own solo");
      assert.notInclude(prompt, "Archived digest item");
      assert.notInclude(prompt, "Archived active solo");
      assert.notInclude(prompt, "Alpha project detail that stays out");

      documents.set(
        `${beta.id}:DIGEST.md`,
        documentFor(
          beta,
          "DIGEST.md",
          `# Beta digest\n\n## New\n\n- Beta digest item\n- ${"x".repeat(5_000)}\n`,
        ),
      );
      generationPrompts.length = 0;
      yield* service.generate({ captainId: chorus.id });
      const cappedPrompt = generationPrompts[0]!;
      assert.include(cappedPrompt, "Beta digest item");
      assert.notInclude(cappedPrompt, "x".repeat(5_000));
      assert.isBelow(cappedPrompt.length, 13_000);
    }).pipe(Effect.provide(layer));
  }),
);

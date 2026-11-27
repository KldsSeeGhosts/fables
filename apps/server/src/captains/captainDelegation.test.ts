import { assert, it } from "@effect/vitest";
import { CaptainId, ProjectId, ThreadId, type Captain } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as CaptainStore from "./CaptainStore.ts";
import { captainDelegationProject } from "./captainDelegation.ts";

const scratch = ProjectId.make("scratch");
const project = ProjectId.make("project");
const secondProject = ProjectId.make("project-2");
const archivedOnlyProject = ProjectId.make("project-archived-only");

const captain = (id: string, patch: Partial<Captain> = {}): Captain => ({
  id: CaptainId.make(id),
  primaryThreadId: ThreadId.make(`captain:${id}:0`),
  earlierThreadIds: [],
  name: id,
  role: "Coordinator",
  instructions: "",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "react",
  coordinatorOnly: true,
  kind: "duet",
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
  archivedAt: null,
  ...patch,
});

const layer = CaptainStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

it.effect("lets a Chorus delegate only projects no active Duet covers", () =>
  Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const chorus = captain("chorus", { kind: "chorus" });
    const delegate = (projectId: ProjectId, caller: Captain = chorus) =>
      captainDelegationProject({
        captain: caller,
        currentProjectId: scratch,
        requestedProjectId: projectId,
      });

    assert.equal(yield* delegate(project), project);

    yield* store.save(chorus);
    assert.equal(yield* delegate(project), project);

    const allProjects = captain("all-projects");
    yield* store.save(allProjects);
    const emptyScopeDenial = yield* Effect.flip(delegate(secondProject));
    assert.equal(emptyScopeDenial.code, "invalid_request");
    assert.include(emptyScopeDenial.message, "Route this with duet_send to all-projects.");
    assert.include(emptyScopeDenial.message, "Do not start a Solo for this project yourself.");

    yield* store.save({ ...allProjects, archivedAt: "2026-11-24T11:00:00.000Z" });
    assert.equal(yield* delegate(secondProject), secondProject);

    const maria = captain("maria", { scopedProjectIds: [project] });
    const lee = captain("lee", { scopedProjectIds: [project, secondProject] });
    yield* store.save(maria);
    yield* store.save(lee);
    const scopedDenial = yield* Effect.flip(delegate(project));
    assert.equal(scopedDenial.code, "invalid_request");
    assert.include(scopedDenial.message, "duet_send");
    assert.include(scopedDenial.message, "maria");
    assert.include(scopedDenial.message, "lee");

    assert.equal(
      yield* delegate(ProjectId.make("project-uncovered")),
      ProjectId.make("project-uncovered"),
    );

    const archived = captain("archived", {
      scopedProjectIds: [archivedOnlyProject],
      archivedAt: "2026-11-24T11:00:00.000Z",
    });
    yield* store.save(archived);
    assert.equal(yield* delegate(archivedOnlyProject), archivedOnlyProject);

    const ordinaryDuet = captain("ordinary");
    assert.equal(yield* delegate(project, ordinaryDuet), project);
  }).pipe(Effect.provide(layer)),
);

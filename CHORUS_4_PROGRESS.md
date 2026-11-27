# Chorus step 4 progress

- Branch `ksg/chorus-4-coverage` created from local `ksg/dev` at `a4490b9b22`.
- Read issue #8, AGENTS.md, evals/README.md, docs/internals/02_effect-services.md, and docs/internals/15_testing.md.
- Next: trace Captain delegation, Solo projection records, briefing context, tests, and eval structure.
- Traced delegation through `OrchestratorMcpService.delegateTask` into `captainDelegationProject`; the local target-project guard currently treats an empty-scope caller as confined to its parent project, so Chorus needs a Chorus-only exception.
- Found the briefing and crew-rule seam in `captainTurnContext.ts`; finished Solos are available through `orchestration_v2_projection_subagents`, with local child projects available by joining `orchestration_v2_projection_threads`.
- Eval harness already supports `captainKind: "chorus"` and Chorus cases; step 4 will extend it for repeat-project briefing hints without copying prompt text into cases.
- Implemented local Chorus coverage: active Duets with an empty scope cover every local project, scoped Duets cover only listed projects, archived Duets and the Chorus itself do not count, and a covered delegation fails with a `duet_send` routing message.
- Added the Chorus 30-day soft rule, repeat-project briefing hint, and default-only Solo rules for Chorus children. Kept the coverage reader injectable so step 5 can evaluate peer state.
- `vp run typecheck` in `apps/server` passes after the implementation edit.

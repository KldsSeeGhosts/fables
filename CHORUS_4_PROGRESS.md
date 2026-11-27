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
- Added focused coverage tests for no Duets, empty-scope and scoped Duets, archived Duets, the Chorus itself, normal Duet behavior, the denial copy, cross-project local dispatch, repeat-project hints, and Chorus-only Solo rules.
- Focused result: `vp test run apps/server/src/captains/captainDelegation.test.ts apps/server/src/captains/captainTurnContext.test.ts apps/server/src/captains/CaptainService.test.ts apps/server/src/mcp/OrchestratorMcpService.test.ts` passed 140 tests.
- Eval iteration showed DeepSeek needed explicit Solo mechanics, exact `target.projectId` guidance, and a stronger stop-and-offer repeat rule; the briefing now says those directly.
- Final focused result: 4 test files passed, 140 tests. `vp run typecheck` in `apps/server` passed.
- Final eval result: `pnpm mcp-tool-use --cases mcp-tool-use/cases/chorus-coverage.ndjson --model opencode-go/deepseek-v4.1-flash --shell-model gpt-6.1-terra --samples 3 --out runs/chorus-coverage-final3` passed 9/9 samples: repeat suggestion 3/3, approved repeat Solo 3/3, first one-off 3/3.

# W2 agent-runtime — coordinator progress

Branch: `cloud/w2-agent-runtime` (from `origin/general-work`). Lot branches: `cloud/w2-agent-runtime-<LOT>`.
Personas loaded by coordinator: Software Architect (`AI-Dev-Shop/agents/software-architect/skills.md`) and Code Inspection (`AI-Dev-Shop/agents/code-inspection/skills.md`) — both read at start.

## Lot ordering (architect lens: one lot per shared folder at a time)
- Folder groups: src-root {L015 → L045 → L174}, defs {L031 → L283}, agent-protocol {L059}, skills {L198}.
- Round 1 (parallel, 4): L015, L031, L059, L198. Then L045 after L015, L283 after L031, L174 after L045.

## Baseline worst cyc/cog (coordinator temp eslint, thresholds 10/10)
claude-segment-usage 32/25, detection 23/19, model-discovery 34/24, qoder-stream 28/37 | defs: amr 14/14, claude 31/21, codebuddy 20/12, codex 45/34, cursor-agent 12/-, opencode 13/-, qoder 13/-, shared 16/-, antigravity 11/-, pi 11/- | acp: json -/11, models 20/20, session-params 25/19, session 15/12, updates 14/15 | auth 16/16, copilot-stream 23/13, env 21/19, model-discovery-shared 20/14, models 24/16, opencode-log 14/15 | claude-code-models 17/-, claude-stream 12/-, executables 15/11, launch 13/12 | BubbleScene 18/16

## Lot status
| Lot | Status | Branch commits | worst cyc/cog before→after | coverage | verify |
|---|---|---|---|---|---|
| L015 | MERGED ab39c8b9 | fc130af2, 760e4825, cdd621d4, a8b28ff8, 75a0a244, 1038df5f, 1ca33b74, 3b6a6489 | claude-segment-usage 32/25, detection 23/19, model-discovery 34/24, qoder-stream 28/37 → all ≤10 | 100/100/100 on all 4 (531 tests) | eslint 0, tsc ok, `pnpm guard` output identical before/after (pre-existing failures); removed comments only described deleted code |
| L031 | MERGED f4b9569b | 17 commits b2cbb7bc..779a86e9 | amr 14/14, claude 31/21, codebuddy 20/12, codex 45/34, cursor-agent 12, opencode 13, qoder 13, shared 16 → all ≤10 | 100/100/100 on all 8 + new defs/claude-compatible-args.ts (597 tests) | eslint 0, tsc ok; 154 removed comment lines checked: all moved except amr retry comment describing the deleted unreachable loop (replaced) |
| L045 | MERGED 4d9f1036 | 5f1bfa66..34646e9d (12) + fixup df9f2b5f | auth 16/16, copilot-stream 23/13, env 21/19, model-discovery-shared 20/14, models 24/16, opencode-log 14/15 → all ≤10 | 100/100/100 on all 6 (422 tests) | first merge attempt REVERTED locally (unpushed): +2 `pnpm guard` HW3-module-state (new module Maps); fresh fixer typed them ReadonlyMap → guard back to 26 baseline. auth/env diffs reviewed line-by-line: equivalent | | | | |
| L059 | MERGED 5dc18720 | fa204f53, 568038fd, 10a3b051, dc446d1b, 8e7b9c4e, 35d2023e, 3749c3bb | json -/11, models 20/20, session-params 25/19, session 15/12, updates 14/15 → all ≤10 (0 violations) | 100/100/100 on all 5 (438 acp tests) | eslint 0, tsc ok; why-comments verified moved; behaviour-preserving extractions |
| L174 | dispatched 02:25Z | | | | |
| L198 | MERGED 0f6c99be | 88dca258, c6667314 | 18/16 → ≤10/≤10 (0 violations) | 100/100/100 (34 tests; needs `--coverage.exclude=__none__`) | eslint 0, tsc ok, tests green; markup proof 864 old-vs-new renders identical (temp test deleted) |
| L283 | MERGED 95a9e86d | 7c4964d6, 073a6995, bacab59c | antigravity 11/- → 8/9, pi 11/- → 5/2 | 100/100/100 both (544 defs tests) | eslint 0, tsc ok; removed dead empty-id/label guards in parseAgyModels (provably unreachable: line trimmed) |  | | | |

## Timings
- Setup (install + `pnpm --no-bail -r build`): 156 s; only `@jini-ai/integrations` failed tsc (expected), all dist emitted.
- Baseline: all 66 lot test files green on unmodified tree (1449 passed, 1 pre-existing skip). agent-runtime tsc clean.
- Round 1 dispatched 01:30Z.
## Problems
- L045 BUG pinned (reported, not fixed): copilot-stream `flush()` — if `onEvent` throws on a valid record, the same line is re-emitted as a `raw` event (same pattern as qoder-stream, L015).
- L045 follow-ups: scripts/hardwiring-debt.json has a now-stale HW3 entry for auth.ts:308 (old TAILORED_AUTH_AGENTS Set, removed) — stale count 3→4, out of scope. `validateRuntimeSelection`/`concreteModelOptions` keep an unused exported `_options = {}` param (public signature).
- Lesson: run `pnpm guard` in VERIFY for every lot (catches HW3 module-state from Map/Set lookup tables introduced by refactors); tell subagents to type module-scope Map/Set as ReadonlyMap/ReadonlySet.
- L015 BUGS pinned (reported, not fixed): (a) detection `probeAgentModels` reports any discovery failure (e.g. throwing clock) as "Agent executable is unavailable." though the binary was found; (b) qoder-stream: if the event sink throws, the error is swallowed and the parsed line is re-sent as a `raw` event.
- L015 minor behaviour shifts (accepted): `staticResolve` with no selection no longer matches a label-less catalog row (type-violating data only); `detectAgents` refreshes the remembered model list per agent as each finishes instead of after all (same end state).
- L031 follow-ups: vitest.config.ts (~line 56) comment about amr `fetchVelaRemoteModelsWithRetry` unreachable end is now stale (loop rewritten, no unreachable code) — out of lot scope, not edited. Possible issue: opencode `listModels.timeoutMs` 15s not passed to its `createAgentModelDiscovery` config (may use default budget).
- L059 BUG pinned (reported, not fixed): acp/session.ts `state.setModelRequestId` starts `null`, so a JSON-RPC error with `id: null` + recoverable code before the prompt (no model pinned) is treated as a failed set_model → prompt sent before session/new ack + `model: default` status. Test "...sends the prompt early (reported, not fixed)".
- L059: acp tests still use the pre-existing `spawn as unknown as ReturnType<typeof vi.fn>` cast pattern (15 sites before; +1 new following it). Follow-up: retype the fake child/spawn helpers.
- L198: BubbleScene test resolves react from the root `node_modules/.pnpm/node_modules` hoist dir (template is not a workspace member); template tsc only checked against a remotion stub.
## Next

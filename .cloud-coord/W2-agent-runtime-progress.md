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
| L015 | dispatched 01:30Z | | | | |
| L031 | dispatched 01:30Z | | | | |
| L045 | pending | | | | |
| L059 | dispatched 01:30Z | | | | |
| L174 | pending | | | | |
| L198 | MERGED 0f6c99be | 88dca258, c6667314 | 18/16 → ≤10/≤10 (0 violations) | 100/100/100 (34 tests; needs `--coverage.exclude=__none__`) | eslint 0, tsc ok, tests green; markup proof 864 old-vs-new renders identical (temp test deleted) |
| L283 | pending | | | | |

## Timings
- Setup (install + `pnpm --no-bail -r build`): 156 s; only `@jini-ai/integrations` failed tsc (expected), all dist emitted.
- Baseline: all 66 lot test files green on unmodified tree (1449 passed, 1 pre-existing skip). agent-runtime tsc clean.
- Round 1 dispatched 01:30Z.
## Problems
- L198: BubbleScene test resolves react from the root `node_modules/.pnpm/node_modules` hoist dir (template is not a workspace member); template tsc only checked against a remotion stub.
## Next

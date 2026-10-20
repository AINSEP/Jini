# W1 admin — coordinator progress

Coordinator branch: `cloud/w1-admin` (from `origin/general-work`). Lot branches: `cloud/w1-admin-<LOT>`.
Started 2026-10-19 23:59 UTC. Setup 23:59:40→00:02:28 (2m48s); integrations build fails tsc (expected), all else emits dist. Baseline `tsc --noEmit -p packages/admin` green.

## Baseline (temp eslint, cyc/cog limit 10): 95 violations across the lot files

| Lot | Scope | Baseline worst cyc/cog | Status | After | Coverage | Commits | Verify |
|---|---|---|---|---|---|---|---|
| L051 | media/react | 32/20 | merged | ≤10/≤10 (eslint 0) | 100/100/100 | 5364aaba,85704148,fd995fe9,c3b2a9c8,2708fd64 | eslint 0, tsc 0, src/media/react 12 files/142 tests green; markup parity proven; new module-internal export settleFromCache (MediaPage.hooks, not in barrel); NOTE subagents collided in shared scratchpad (give each its own dir next wave); 32m/158k tok |
| L053 | forms (files) | 30/32 | merged | ≤10/≤10 (eslint 0) | 100/100/100 | 530f21a8, 1bb2d911 | eslint 0, tsc 0, 4 test files/117 tests green; why-comments moved; no weakened asserts; 9m/118k tok |
| L054 | react | 24/19 | merged | ≤10/≤10 (eslint 0) | 100/100/100 all except AdminShell.tsx branches 97.8% (panelId ?? '' unreachable: resolveAdminShellModel always falls back, but exported AdminShellModel.route.panelId is string|null in model.ts — out of lot; no ignore added) | 3a73eecf,f0d32dbc,c453677b,27ff67af,a841654c,07c54ee4,a0580711 | eslint 0, tsc 0, src/react 28 files/340 tests green; markup parity proven; tests git-mv'd to feature __tests__; new RelationTruncationNotice.tsx dedupes notice; session-hook try/finally removal traced equivalent; 25m/200k tok |
| L069 | security (sensitive) | 32/14 | merged | ≤10/≤10 (eslint 0) | 100/100/100 | 21ee6642,fa3ef9df,510ec089(+fix e5e4777b),4e3940f9,12e03d46,2cef949c,87146d51,e037ef85 | eslint 0, tsc 0, 9 files/224 tests green; coordinator hand-traced controllers/rules/http diff: behaviour-equivalent on every branch, no message/code change; NOTE intermediate 510ec089 does not typecheck (fixed in e5e4777b, merge tip green); 23m/204k tok |
| L087 | seo | 28/24 | merged | ≤10/≤10 (eslint 0) | 100/100/100 | 19ea6d0d,10be7438,1a728867,8882bb5b | eslint 0, tsc 0, 4 files/204 tests green; markup parity proven (864+1152 combos, temp tests deleted); comments intact; 2 'as unknown as' are malformed-input tests (accepted); 20m/149k tok |
| L107 | agent-plugins | 23/13 | merged | ≤10/≤10 (eslint 0) | 100/100/100 | 547ac8b5,5e34c243,81177989,127da791,756e92e2,f284135d,983ea821 | eslint 0, tsc 0, 8 files/116 tests green; removed post-await disposed checks verified (dispose bumps generation; store.set no-ops after dispose); MESSAGES CHANGED: AgentPluginsPage confirm throw now names plugin id + next step (tests updated, UI shows errorLabel); files-controller internal error names both ids; 17m/146k tok |
| L144 | comments | 22/≤10 | merged | 8/5, 8/3, 10/6, 6/0, 5/0 (eslint 0) | 100/100/100 | d2c1460b,0cad3225,6b2f1467,a73b6e41,7a6551f7 | eslint 0, tsc 0, src/comments 12 files/160 tests green; 21 conformance check names/order pinned; removed 'Stale moderation unexpectedly succeeded' throw verified equivalent (stale-success still fails the check, pinned); MESSAGES CHANGED (memory adapter, unpinned before, no repo-wide matches): settings/moderation-action/version-conflict/not-found now name field/action/id + next step; 18m/155k tok |
| L157 | widgets | 15/≤10 | merged | 8/3, 9/7, 9/4, 8/6, 8/1, 8/1 (eslint 0) | 100/100/100 | b900a967 (msg says 14->6; real 14->8, corrected in d6e3627f),d6e3627f,81a5f26a,15a7007f,9beba1a4,a683fe9b | eslint 0, tsc 0, src/widgets 17 files/214 tests green (151 before); 23 conformance check names/order pinned; BUG PINNED: instance editor keeps stale existing-widget load error after switching to create route; 19m/155k tok |
| L192 | forms/conformance | 20/15 | merged | 8/4 (eslint 0) | 100/100/100 | e8c0d8f8 | eslint 0, tsc 0, 16/16 green; 20 check names/order/API sequence unchanged; original test assertions intact (fixture extracted); BUG PINNED: cross-form trash accepted by host → harness crashes ('form definition s1 was not found') instead of reporting a failure; 3m/79k tok |
| L207 | forms/react | 14/12 | merged | 6/5, 9/9, 9/5 (eslint 0) | 100/100/100 (incl. 3 new part files) | fdad80f7,5fc2ab6e,a9a4390f | eslint 0, tsc 0, src/forms/react 19 files/134 tests green; markup parity proven; 3 new sibling part files; FLAGGED: stray FormEditorHeaderText doc comment at end of FormEditorFieldsBody.tsx and stale 'Not useMemo'd' comment in FormSubmissions.tsx (both need out-of-lot edits); 9m/119k tok |

## Final (2026-10-20 ~01:10 UTC)

- All 10 lots merged into `cloud/w1-admin`. Aggregate temp-eslint (cyc/cog 10) over all 55 changed admin src files: **0** (baseline 95).
- `pnpm --filter @jini-ai/admin build` OK; `tsc --noEmit -p packages/admin` 0; whole package suite `vitest run --maxWorkers=4`: **166 files / 2218 tests passed** (74 s). No failures, so no origin/general-work comparison needed.
- Parallelism: 5 concurrent subagents throughout; each finished lot immediately backfilled.

## Problems / notes

- Bugs pinned (reported, not fixed): (1) forms conformance harness crashes ("form definition 's1' was not found") instead of reporting a failure when a host accepts a cross-form trash (L192). (2) Widgets instance editor keeps a stale existing-widget load error after switching to the create route (L157).
- Out-of-lot follow-ups: AdminShell.tsx 97.8% branches — `route.panelId ?? ''` unreachable because `resolveAdminShellModel` always falls back, but `AdminShellModel.route.panelId` is typed `string | null` in react/shell/model.ts (narrow it). FormEditorFieldsBody.tsx carries a stray FormEditorHeaderText doc comment; FormSubmissions.tsx "Not useMemo'd" comment is stale (logic now in useSubmissionsView).
- Error messages changed: L107 AgentPluginsPage confirm throw + files-controller internal error; L144 comments memory adapter (4 messages). All listed in lot rows.
- Commit hygiene: L069 510ec089 does not typecheck alone (fixed by e5e4777b); L157 b900a967 message says cyc 14->6 (real 14->8).
- Shared scratchpad collision between subagents (one overwrote another's helper script) — give each subagent its own scratch subdir.

## Next

Wave 1 admin complete. Branch is ready for human review / merge into general-work (coordinator never pushes there).

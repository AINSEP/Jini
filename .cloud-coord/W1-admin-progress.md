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
| L144 | comments | 22/≤10 | pending | | | | |
| L157 | widgets | 15/≤10 | pending | | | | |
| L192 | forms/conformance | 20/15 | merged | 8/4 (eslint 0) | 100/100/100 | e8c0d8f8 | eslint 0, tsc 0, 16/16 green; 20 check names/order/API sequence unchanged; original test assertions intact (fixture extracted); BUG PINNED: cross-form trash accepted by host → harness crashes ('form definition s1 was not found') instead of reporting a failure; 3m/79k tok |
| L207 | forms/react | 14/12 | merged | 6/5, 9/9, 9/5 (eslint 0) | 100/100/100 (incl. 3 new part files) | fdad80f7,5fc2ab6e,a9a4390f | eslint 0, tsc 0, src/forms/react 19 files/134 tests green; markup parity proven; 3 new sibling part files; FLAGGED: stray FormEditorHeaderText doc comment at end of FormEditorFieldsBody.tsx and stale 'Not useMemo'd' comment in FormSubmissions.tsx (both need out-of-lot edits); 9m/119k tok |

## Problems / notes

## Next

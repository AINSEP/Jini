# W3 user-management — coordinator progress

Branch: `cloud/w3-user-management` (from origin/general-work). Brief: `origin/cloud/w3-briefs:.cloud-coord/W3-user-management-brief.md`.

## Persona loads
- Coordinator: software-architect, code-inspection, security skills.md loaded from `/home/user/AI-Dev-Shop` (clone of leonaburime-ucla/AI-Dev-Shop, depth 1).
- Subagents: see lot table (confirmation line per lot).

## Setup notes
- STEP 0: `Linux vm 6.18.44-fc-v139 x86_64 GNU/Linux`, host `vm`, `/home/user/Jini`, 2026-10-20T04:41:36Z, container node v22.22.0.
- Node 24: nodejs.org tarball v24.22.0 (sha256 verified) into `~/.local/node24`; every command prefixes `PATH=$HOME/.local/node24/bin:$PATH` (editing shell profiles was refused by the sandbox).
- `pnpm install --frozen-lockfile` 23 s (argon2 build script ignored by pnpm, but its prebuilt binary works).
- `pnpm --no-bail -r build` 110 s; only `@jini-ai/integrations` failed tsc (expected), dist emitted for all 36 packages.
- Baseline `tsc --noEmit -p packages/user-management`: 0 errors.
- Baseline eslint (cyc/cog 10) on the 19 lot files: 32 violations, matching the brief's list.
- Baseline `pnpm guard` on origin/general-work FAILS with 26 violations, 0 in user-management (HW1/HW3/N1/R10 in daemon, agent-plugins, agent-runtime, chat, cms, core, diagnostics, platform, ui). Merge criterion used: no new guard lines vs base (`/tmp/w3-user-management-coord/guard-base.sorted`).
- Worktrees at `/home/user/wt-<LOT>`, dist copied from main checkout (including `packages/*/*/dist`), scratch `/tmp/w3-user-management-<LOT>/` with a pre-seeded `cx.config.mjs`.

## Lot status

| Lot | Status | Branch | Persona confirm | Notes |
|---|---|---|---|---|
| L105 | MERGED dcac503c | cloud/w3-user-management-L105 | yes | 48e657ae,45e64453,f299df18,fe8ead1a |
| L118a | MERGED 14bf78a1 | cloud/w3-user-management-L118a | yes | ba8e419f,5a7566db,ecda8d7b,36716963 |
| L118b | MERGED dd026c27 | cloud/w3-user-management-L118b | yes | fc5def69,9dd1558d |
| L182a | MERGED cecbc9ef | cloud/w3-user-management-L182a | yes | 6ed390c0,7e0a494f |
| L182c | MERGED 8b952d6c | cloud/w3-user-management-L182c | yes | 329b2756,7055fa49,78fddb94,de16cc2f |
| L182b | MERGED e14dc212 | cloud/w3-user-management-L182b | yes | 51aa0b60,4bfead36 |
| L154-L272 | MERGED dbc7e899 (2nd attempt) | cloud/w3-user-management-L154-L272 | yes | 2c053b61,00b5be9a,9d9918a8,a28864fa,7885c2d0,2c76e58d |
| L205 | MERGED 393cb657 | cloud/w3-user-management-L205 | yes | 18e790cb,e347d0cd,a9ceeaf6,093b5ac8,c4cdebcc,38915e09 |

## Merges / verification
Verify = coordinator eslint (cyc/cog 10) on lot files + new helpers, tsc, lot tests + importers (no `Errors` line), pnpm guard (no new lines vs base), own coverage run, diff read (as-any/as-unknown, comment moves, secrets).

### L182a — Users.tsx complexity (merged cecbc9ef)
- Measured (subagent): UserRow 16/10→6/5, Users 11/6→9/4; new UserRowParts.tsx (all ≤5/2). Coordinator eslint: 0.
- tsc 0; 5 test files / 82 tests pass, no Errors line; guard no new lines.
- Coordinator coverage (5 importer files): UserRowParts.tsx 100/100/100/100; Users.tsx 80.92 stmts / 86.11 branch / 57.14 funcs (rest is L182b).
- Markup identity: temp old-vs-new innerHTML test over 14 controller states (useId normalised), deleted.
- RED: 7 functions each caught. Removed: redundant keyed Fragment. Checks removed: none. Comments: 0 removed. One `as unknown as` = labelled malformed-input fixture.
- Security: none seen.

### L118b — auth-service / permission-migrations / seed (merged dd026c27)
- Measured: auth-service login 12/4→7/4; permission-migrations fan-out 6/13→6/8; seed seedIdentity 13/6→6/3. Coordinator eslint 0.
- tsc 0; 13 files / 202 tests; guard no new lines.
- Coordinator coverage (24 server test files, 325 tests): all three 100/100/100/100, no artifact lines.
- Identity proof: call-trace pins (55 tests) green on old + new; temp 1000-case old-vs-new differential deleted.
- Removed: dead `nowIso` params, duplicate system-principal lookup, 4x repeated message fallback, redundant local, 3 role-seed calls → table loop. Checks removed: none. Seed why-comments moved into doc comments (verified).
- BUG/SEC pinned (reported, not fixed): permission-migrations `grantMissingTargets` ignores scope/constraints of held `from` grants → a scoped `from` yields an UNSCOPED `to` grant (privilege widening); scoped `to` blocks the unscoped grant.
- SEC pinned (reported): `login` skips the hash for unknown/disabled users → timing reveals username existence.
- SEC noted (not pinned): `validateSession` compares ISO strings (`expiresAt <= nowIso`); non-normalised host `nowIso` could mis-judge expiry.

### L118a — admin-crud-service / agent-tool-input (merged 14bf78a1)
- Measured: assertSchemaIsInterpretable 19/18→8/7, parseIdentityToolInput 18/19→6/2, resolveUpdatedUsername 11→5; files' worst now 8/8 and updatePolicy 10/7 (untouched). Coordinator eslint 0.
- tsc 0; 6 files / 175 tests; guard no new lines.
- Coordinator coverage (all 23 server test files, 366 tests): both 100/100/100/100.
- Removed: unused `_optional` param; duplicate `schema.type !== "object"` check and always-true `additionalProperties === false` wrapper merged (proof in ecda8d7b: assertSchemaIsInterpretable throws identically first; pinned).
- BUG/SEC pinned (reported, not fixed): parser validates only own `properties`/`required` but reads them with normal (prototype-following) access → inherited schema members are enforced unchecked (fail-open, e.g. type:number property accepted). Exported from src/server/index.ts.
- Left: transaction+permission-gate opening duplicated across 8 transitions in admin-crud-service (not extracted; touches every SEC transition).

### L105 — roles/users controllers (merged dcac503c)
- Measured: roles writePermission 13/0→6/1, confirmDestructive 13/12→9/5 (file worst loadPermissions 10/8, untouched); users savePanel 21/26→8/7, confirmDestructive 19/15→9/6 (worst createUser 9/4). Coordinator eslint 0.
- CORRECTION: commit fe8ead1a's message says "savePanel 6/x"; the measured value is 8/7 (history not rewritten).
- tsc 0; 6 files / 135 tests; guard no new lines.
- Coordinator coverage, subagent's 6-file set: both 100/100/100/100. With all 28 admin test files: 99.45/99.34 branch on `finally` lines roles:259 / users:129 — coverage can't drop by adding tests, so this is a v8 merge artifact on `finally` blocks (recorded, accepted).
- Identity proof: pins green on old (roles 52, users 45); temp 400-sequence randomized old-vs-new differential deleted.
- Removed: duplicated try/catch/finally → formWrite/rowWrite; nested ternaries → capture()/panelWrites table. Checks removed: none. Comments: none lost. `as unknown as` x2 = malformed `me` port fixtures in pins.
- SEC note: `setDraft` passes patches unfiltered (UI can set busy/pending fields); UI-side only, server enforces authority.

### L182c — use-users / use-members hooks, errors.ts (merged 8b952d6c)
- Measured: describeIdentityError 13/12→8/3; useMembers 12/0→6/0 (worst onToggleDetail 8/5); useUsers 16/0→5/2, canRenameUser 10/4→8/3. Coordinator eslint 0.
- tsc 0; 8 files / 160 tests; guard no new lines.
- Coordinator coverage (all 17 react test files, 231 tests): all three 100/100/100/100.
- Removed: `boundT` alias; duplicate list/detail query+loader incl. 2 dead fetch closures; triple own-row lookup → selectCaller; runGrantMutation 7 positional args → object. Checks removed: none (deep-link guard re-expressed via ownProfile, same derivation). Comments: none lost.
- BUG pinned (reported, not fixed): describeIdentityError looks codes up through Object.prototype ("constructor" → Object fn passed to translate).
- SEC note: errors.ts surfaces raw Error.message for VALIDATION_ERROR and unmapped codes (could leak server-internal text).

### L182b — Users.tsx coverage (merged e14dc212)
- Tests only (+36 in Users.coverage.test.tsx, 62 expects); Users.tsx diff empty. Coordinator eslint 0; tsc 0; 7 files / 163 tests; guard no new lines.
- Coordinator coverage (all react + people suites, 232 tests): Users.tsx 100/100/100/100 (was 80.92/86.11/57.14), UserRowParts.tsx 100.
- RED: 12 previously-uncovered functions each caught (EyeIcon needed a stricter assertion, added).
- Security: none seen (show/hide password keeps autocomplete=new-password, pinned).

### L205 — admin react MemberRow / page hooks / pages (merged 393cb657)
- Measured: MemberRow 10/13→7/4; useRolesPage 13/0→7/3; useUserRow 13→8/4; useUsersConfirmation 11→6/1; RolesPage 11→8/4; UsersPage 12→9/4 (new helpers all ≤6/3). Coordinator eslint 0; tsc 0; 6 files / 78 tests; guard no new lines.
- Coordinator coverage (exact 5 files, 259 tests): all 100/100/100/100.
- Markup identity: temp old-vs-new innerHTML over 768/1024/2048 combos + hook return/call-log diff over 384 cases, deleted.
- Removed: repeated tab-id slice → tabKey; 4 push lines → rowActions table; duplicate option builder → grantOptions; ternaries → maps/early returns. Checks removed: none. Bugs/security: none seen.

### L154-L272 — people.rules / rules / memory adapter (rejected once, then merged dbc7e899)
- First merge attempt: eslint 0, tsc 0, 25 files / 344 tests, coverage 100% on all 4 files incl. new error-copy.ts — but `pnpm guard` added `HW3-module-state packages/user-management/src/admin/people.rules.ts` (module-level `new Map` ACTION_RULES without ReadonlyMap type). Merge dropped locally (was never pushed); fresh fix subagent dispatched.
- Fix subagent pushed 2c76e58d (`ACTION_RULES: ReadonlyMap<…>`). Re-merge: eslint 0 (incl. error-copy.ts), tsc 0, 25 files / 344 tests, guard no new lines; coordinator coverage (314 tests) error-copy/people.rules/rules/memory all 100/100/100/100.
- Coordinator SEC read: old vs new userActionAllowed compared rule by rule (ownership gate, delete/disable/enable/reset/grants/email, unknown→user.manage, caller-null first): logically identical, same evaluation order. Subagent proof: committed 6,912-combination truth table + temp 200k-input differential (deleted).
- Removed: duplicated error-code/message extraction → error-copy.ts; canManageRoles/issuer check → hasAdminGrant; memory: 3 seeding loops → inWorkspace(), 4 abort checks → check(), 2 ownership ternaries → ownership(), 2 last-owner guards → keepAnotherActiveOwner(). Checks removed: none.
- BUG pinned (reported): describeRolesError resolves inherited keys ("constructor" → Object fn).
- SEC pinned (reported, memory fake only): users `write()` checks existence/Trash before permission (id enumeration by an ungranted caller); members fake serves listMembers/getMember (emails) without member.manage.
- Commit messages 00b5be9a/9d9918a8/a28864fa carry pre-measurement (wrong) figures; empty commit 7885c2d0 records measured ones: userActionAllowed 27/17→5/1, describeRolesError 12/12→5/3, createMemoryRolesApi 13/0→4/0.

## Final verification (wave head cc6c0cf7 + this file)
- `pnpm --filter @jini-ai/user-management build`: ok.
- Whole suite (wave): 71 files / 964 tests passed, EXIT 0, no `Errors` line, 23 s.
- Whole suite (base origin/general-work 6bdca722, clean worktree, run after the wave): 50 files / 451 tests passed, no `Errors` line. No failures on either side.
- tsc --noEmit -p packages/user-management: 0. pnpm guard: 26 violations, identical to base (0 in user-management, 0 new).
- Coordinator eslint (cyc/cog 10) on all 19 lot files + new helpers (UserRowParts.tsx, error-copy.ts): 0 (base: 32).
- Worktrees removed; no processes left.

## Subagent usage
L105 177k/57 calls; L118a 139k/44; L118b 145k/39; L182a 135k/45; L182b 132k/30; L182c 197k/56; L154-L272 145k/44; L205 155k/58; L154 fix 58k/7. No hand-offs, none past 200k.

## Open items for the owner (reported, not fixed)
1. SEC permission-migrations `grantMissingTargets`: scoped `from` grant → unscoped `to` grant (privilege widening).
2. SEC agent-tool-input: inherited (prototype) schema members enforced but never validated (fail-open).
3. SEC auth-service `login`: no dummy hash for unknown/disabled users → username enumeration by timing.
4. auth-service `validateSession` ISO string compare depends on normalised `nowIso` (not pinned).
5. errors.ts / rules.ts code lookup through Object.prototype ("constructor").
6. errors.ts shows raw Error.message for VALIDATION_ERROR/unmapped codes.
7. memory adapter fakes: existence-before-permission in users write(); members list/get without member.manage.
8. Wrong complexity figures in commit messages fe8ead1a (L105) and 00b5be9a/9d9918a8/a28864fa (L154; corrected by 7885c2d0); history not rewritten.

## Next steps
- Wave complete. Owner reviews cloud/w3-user-management and merges into general-work.

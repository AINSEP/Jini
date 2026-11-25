PARTIAL af36ef102 664288798: left P10-U4b.T (not started; needs packaged witnesses), P10-U4a.T restart-resume witness + hand-off-keyed apply registration (needs U4b supervisor), P10-O1.T (BLOCKED: no composed host ErrorReporter from P4), P10-S2.T Reload button; AG-UI/CLI run usage and S5 copy edits NOT-SHEETED

# b-g5a (2026-11-25): P10 observability + bug-class sweeps (p10a) and site update from production (p10c)

This was an unattended cloud run. Opus coordinated, tested the Sol branches, did the merges, built O2.T (queue half) and S5.T, and fixed the small bugs. Workers built every other OPUS sheet test-first, each in its own worktree pair: opus-high for auth, ordering, redaction and paid-call sheets, Sonnet high for O1.J and S6.J. There were 13 dispatches and never more than 4 at once. I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. Every brief carried its rules and the caps: root cause first, failing test plus a named mutation, inject everything, fn ≤ 80 / complexity ≤ 10, no re-export shells, why-comments move with the code, no host words in Jini, ≤ 50 calls per worker.

- **Base:** Tovu `7c87b3c3f`, Jini `010c8cd87` (`integ/merge-21-2026-11-24`).
- **Sol inputs merged:** Jini `codex/b-p10aj` `2ce789244`, `codex/b-p10cj` `12489a19e`; Tovu `codex/tv-b-p10a` `62b83fb38`.
- **Tips:** Tovu `af36ef102` (code + docs; this report commits on top) and Jini `664288798` (plus this report copy) on `integ/b-g5a-2026-11-25`. Step-by-step WIP is on `integ/wip-b-g5a`, pushed after each step.
- **Setup:** Node 24.22.3. Jini: `pnpm install --frozen-lockfile && pnpm -r build`. Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `link:jini`, `prepare-desktop-hooks`, and `tsc` of `packages/{contracts,sdk}`.
- **Gate 0:** desktop `npm run gates` on merge-21 passed 6/6.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched.
  - No tag, no publish.
  - No schema migration. Themes untouched; the only `apps/admin/src/features/themes/*` edits are the two callback replacements S4.T names.

## Sheets

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P10-O2.J counter kind, drainer gauge, run usage | Sol, tested + fixed by Opus | DONE | observability 16/16, drainer-queue-depth 1/1, otel-surfaces 21/21. Mutations `refused-as-internal` (2 red), `report-claimed-count-as-depth` (red), `omit-output-token-attribute` (1 red). **Fixes:** `failureKindOf` extracted (complexity 14 → ok; every failed status now counted); the drainer test counted the delivery-timeout timer as a drain tick; the original why-comment was kept verbatim and extended. |
| P10-S3.J media call signal | Sol | DONE | engine.test 64/64. Mutation `drop-caller-signal-from-guarded-fetch`: 1 red. |
| P10-S2.J-MFA recordLogin | Sol | DONE | login-record-race 1/1. Mutation `mfa-saves-stale-user-row`: red. Fixture updated after the S2.J merge (Jini `d9a88432e`). |
| P10-U2.J status spec + notice | Sol | DONE | site-update-status 3/3, SiteUpdateNotice 2/2. Mutations `read-before-authorize` and `render-release-notes-as-html` red. Core/devops api baselines refreshed by Opus. |
| P10-S1.T newsletter paging + visitor bounds | Sol | DONE | 77/77 on Sol files. Mutations `send-log-query-without-overfetch` (2 red), `report-unfiltered-total` (1 red). **Fix:** the importer `tool-registrations.newsletter.test.ts` pin now carries `nextCursor: null` (`fef4e16f1`). |
| P10-S3.T-MEDIA stop before paid media | Sol | DONE | Mutations `remove-post-credential-abort-check` and `drop-signal-to-generator`: 2 red each. |
| P10-S4.T replacement audit | Sol | DONE | bug-class-audit-replace 1/1, theme-preview 19/19. **Fix:** one why-comment restored and one debt row added for the deleted numeric-name exemption (`99f057445`). |
| P10-O1.J deploy observation hook | Sonnet | DONE | deploy-observation 6/6 (RED 4 fail before). `bypass-observer-in-registered-deploy`: 4 red. devops src/deploy 340/340. |
| P10-O1.T publish/deploy/import operations | — | **BLOCKED** | P4's composed host `ErrorReporter` does not exist in Tovu (`createErrorReporter` has no host caller). The sheet says to hold rollout at that boundary. O1.J's `observeDeploy` hook is unbound. |
| P10-S3.T BYOK early close | Opus | DONE | early-disconnect 2/2 (RED 2/2 before). `attach-close-after-federation`: 2 red. BYOK lifecycle suite 75/76; the 1 red is pre-existing (inputs-pin, red on merge-21). |
| P10-O2.T queue depth + run usage | Opus (coordinator, queue half) + Opus worker (usage half) | DONE (BYOK); AG-UI/CLI usage NOT-SHEETED | Queue: dialect witness on SQLite + PGlite, RED (missing export) → 2/2. `count-terminal-rows`: both red. Usage: run-usage 3/3. `replace-running-total-with-last-delta`: 1 red. Provider usage events turned out to be cumulative per request: the code keeps each request's last report and sums across requests, and the test pins this with real Anthropic frames. |
| P10-O4.J outbox correlation seam | Opus | DONE | db src/events 33/33, delivery-parent 2/2, tracker 28/28. Mutations `omit-direct-event-preparation` (4 red), `omit-co-persisted-event-preparation` (2 red), `drop-delivery-traceparent` (1 red). A failed preparation stores the original event and does not fail the write. id, workspaceId and occurredAt are fixed. |
| P10-O4.T request → worker ancestry | Opus | DONE | The witness was red on base as predicted, then 2/2. `omit-persisted-parent-on-delivery`: red. Only a valid v00 traceparent is admitted, under a host-reserved key on a copy, stripped before subscribers. Covers the co-persisted command path and legacy events. |
| P10-S2.J identity versions + CAS | Opus (2 workers) | DONE | identity-edit-version 3/3. `substitute-fresh-server-version`: 2 red. `drop-tool-basis-required`: red. HTTP malformed (400) and stale (409) witnesses on the role, policy and user PATCH routes. A versioned profile save keeps the stored login/password bookkeeping (new test). user-management 1909/1913; the 4 reds are pre-existing on merge-21. |
| P10-S2.T SQL CAS + admin basis | Opus (2 workers) | DONE except Reload button | repo.contract 108/108 (SQLite + PGlite + memory). `drop-version-where`: 2 red. identity suite 368/371; all 3 reds are pre-existing or environment: 2 default-credential-exposure (red on merge-21), 1 real-Postgres passkey (no server). Admin: editors send the loaded row version (`expectedVersion`) through Jini core/user-management/admin; the draft is kept on 409 and never resubmitted. Witness `identity saves the loaded basis and preserves the draft on conflict` with `omit-loaded-version-from-save`: 2 red. admin roles + users 563/563; Jini admin roles 168/168. **Left:** a dedicated Reload button (the shared translated conflict message tells the operator to reload). The admin api baseline refresh also absorbed admin drift already on merge-21. |
| P10-S5.T translation audit + witness | Opus (coordinator) | DONE (witness); copy edits NOT-SHEETED | site-chat i18n 3/3. `blank-urdu-launcher-label`: 2 red. A fresh `hygiene-audit` over both merge-21 trees gives 0 Tovu and 2455 Jini candidates. All are split-locale-file blocks (each file holds 3 locales) or the nested `entries` shape in deployment-audit, so no copy edit is warranted. |
| P10-S6.J palette focus + provenance | Sonnet | DONE | dismiss tests 4/4 (2 red before). `omit-opener-focus-on-detach`: 2 red. Command palette 74/74. 46 `archived UI source map` citations commit-qualified, verified against `070311a07^:packages/ui/source-map.md` in a full clone. Required hook props are flagged as a consumer change in the changeset. |
| P10-U2.T status route + admin notice | Opus | DONE | read-status 4/4, wire 2/2, notice 2/2. All 6 mutations red. Deviation: App.tsx imports the bound hook (the view and TovuSiteUpdateNotice still take it as a required prop; check:hooks ok). |
| P10-U4.J prepare/verify split | Opus | DONE | 84/84 site-update + notice; devops src/deploy 353/353. All 5 mutations red. `runSiteUpdate` signature and existing tests unchanged. |
| P10-U3.T readiness, owner, exclusion | Opus | DONE | site-update 53/53 → 55/55 on integ. All 6 mutations red. Production apply stays unexposed: no rehearsal is bound, so readiness blocks. Desktop apply is now blocked too, until U4b supplies staged-candidate rehearsal. |
| P10-U4a.T hand-off + self-hosted check-only | Opus | PARTIAL | self-hosted-binding 7/7 (`record-tag-without-a-supervisor` red), read-status last-attempt 5/5 (`drop-last-attempt-on-feed-failure` red), hand-off cancel/decline 1/1 (`submit-before-approval` red; this one was not test-first). **Left:** the restart-resume witness `redispatch-accepted-operation-on-boot` (needs U4b's journaled supervisor), and apply registration keyed on `runtime.handoff`. |
| P10-U4b.T desktop IPC + supervisor | — | NOT STARTED | Out of budget. It also needs packaged-platform witnesses, which cannot run in the cloud. Desktop stays read-only. |

No `BUILDER: SOL (OPUS-REVIEW)` sheet exists in p10a or p10c, so there was nothing to review under that label.

## Gates vs merge-21

| gate | merge-21 | b-g5a |
|---|---|---|
| desktop `npm run gates` | 6/6 | 6/6 (run on `1de90f7fa`, before the S2.T admin merge; that merge changed no `apps/desktop` file) |
| Tovu root tsc / admin tsc | 0 / 0 | 0 / 0 |
| Tovu check:hooks / boundaries / why-comments (vs merge-21) | ok / 0 err (143 warn) / — | ok / 0 err (143 warn) / ok |
| Tovu changed test files (32 web + node, 2 admin, site-chat) | — | web 497/498 (1 pre-existing red), admin 21/21, site-chat 3/3 |
| Jini typecheck of 12 changed packages | — | all 0 |
| Jini guard | 1 (HW3 shell-failure-log) | 1 (same) |
| Jini check:hooks / why-comments (vs merge-21) | ok | ok / ok |
| Jini complexity ratchet | 12 pre-existing | 12 (same set, none new) |
| Jini api:check | admin + user-management drift | admin drift only. Core, devops, infra, db, integrations, ui and user-management baselines refreshed with changesets. |
| Jini package suites touched | provider-plugins otel 4 red | the same 4 red, nothing new |

## UNVERIFIABLE-IN-CLOUD
- U4b packaged witnesses: old → new → verified, and failed new → offline restore → verified old, on each packaged platform.
- O4.T against a real OTLP collector. The witness uses a recording trace adapter.
- The real Postgres passkey test (no server here).
- S6.J focus behaviour in a real browser. jsdom only; the ref-detach ordering was pinned in jsdom.
- U2.T notice rendering in the real admin shell. Unit and mount-decision tests only.

## New bugs
- **Fixed:**
  - g5a-drainer-test-timer
  - g5a-tool-failure-kind
  - g5a-send-log-wire-pin
  - g5a-s2j-fixtures
- **Logged:** all rows are in `development/open-bugs.md` § b-g5a.
  - g5a-byok-inputs-pin, g5a-contracts-missing-module, g5a-google-catalog-agent-pause, g5a-otel-provider-tests, g5a-default-credential-exposure, g5a-pages-trashed-409. All are pre-existing and red on merge-21.
  - g5a-byok-file-size
  - g5a-byok-client-token-double-count (verify)
  - g5a-ui-provenance-ledger
  - g5a-identity-user-tools-basis
  - g5a-o4-uncovered-writers
  - g5a-u2-jini-spec-principal
  - g5a-site-update-check-error-text
  - g5a-u4a-restart-witness
  - g5a-o1t-blocked
- **Ticked:** `development/todos.md` §M has its status line.

## Commits (merge order on integ/b-g5a-2026-11-25)
Tovu (first-parent):
- `62b83fb38` Sol tv-b-p10a
- `99f057445` why-comments fix
- `fef4e16f1` send-log pin
- `51cdbea49` O2.T queue depth
- `afe28295d` S5.T witness
- merges: `e89a86f32` O4.T, `64d6df1f8` S3.T, `f6bd0f377` U2.T, `fa922f4d5` O2.T usage, `05aecb6b1` U3.T, `98c5cd0c5` S2.T SQL, `97698272d` U4a.T, `d679979dd` S2.T admin
- docs: `cf22bc6d2`, `1de90f7fa`, `af36ef102`

Jini (first-parent):
- Sol: `2ce789244`, merge `d8bc18559` (b-p10cj)
- `f344fc32d` Sol fixes + baselines
- merges: `a7f00c9a3` O1.J, `030e5c253` S6.J, `aeb0c94a1` O4.J
- U4.J: `a5adcda83`, `962991c70`
- `1167ff545` S2.J (+ fixture fix `d9a88432e`)
- S2.T admin: `8b37e22b1`, `6cb361b71`
- `664288798` fake-port pin

Worker branches (local only, merged): `integ/wip-b-g5a-{o1j,s6j,o4j,s2j,s3t,u2t,o4t,u4j,o2u,u3t,s2t,u4a,s2a}`.

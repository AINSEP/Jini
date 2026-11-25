PARTIAL 70915fc0a 09cdf5d27: left = P10-E2.T desktop binding + origin-policy port + check:env wiring; P10-H2.T actorForMutation binding at writers (+ H2.J actor required, system kind); P10-M4.T admin half + alphabetical paging (0048); P10-M5.T2 plain-save/replace/purge-path events + outbox-in-transaction check; P10-C2.T admin live Providers catalog (publish-duplicate-card); P10-H1 host activation (deferred by sheet). All 22 sheets built or partly built; 0 untouched. (SHAs = last code commits; report commits sit on top.)

# b-g5b — P10 env schema, media paging, agent-capability hardening, per-CLI folders, xAI media plugin

- **Branches:** Tovu and Jini `integ/b-g5b-2026-11-25` = `integ/merge-21-2026-11-24` + Jini `codex/b-p10bj` (Sol, one commit, fast-forward) + this run's work. Progress pushes went to `integ/wip-b-g5b` on both repos.
- **Persona:** `AI-Dev-Shop/agents/programmer/skills.md` v1.7.5 (2026-11-05) was read first and applied: Role, and Workflow 5a–5e (confirm RED, test seam, design gate, GREEN, regressions, refactor beat). Subagents were given the same instructions.
- **Inputs:** `plans/sheets-1124b/rev-p10b.md` (4 SOL + 18 OPUS sheets) on `plan/whats-left-1122`; check `reviews/sheets-check-1124b.md` on `plan/sheets-check-1124b`. There are **no `BUILDER: SOL (OPUS-REVIEW)` sheets** in rev-p10b, so there was nothing to review under that label.
- **Setup:** Node 24.22.3 (`/opt/node24/bin` first on PATH). Jini: `pnpm install --frozen-lockfile` and a packages build. Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), `JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini`, `prepare-desktop-hooks`, and a build of `packages/{contracts,sdk}`. No `--no-verify`; `core.hooksPath` was left as set.
- **Workers:** the Opus coordinator ran up to 4 subagents at a time. Opus-high handled security, auth, credential, redaction, migration and ordering sheets; Sonnet-high handled moves and mechanical follow-ups. Each subagent worked test-first, ran its named mutations, and never committed; the coordinator committed by path.
- **Caveat on history:** some sheets first landed inside periodic `wip(b-g5b)` commits. Those were made every few minutes to keep partial work safe while subagents were still editing. Two wip commits briefly captured a temporary mutation; both were reverted in the next real commit (`4fe0f5d68` reverts the M2.J probe mutation captured in `f363220ab`). The SHAs in the table are the commits where each sheet's work first landed.

## Sheets

| sheet | built by | status | tests + mutation | commits (J = Jini, T = Tovu) |
|---|---|---|---|---|
| P10-E1.J-a strict env schema helper | Sol (merged), checked by Opus | DONE | `reports every bad name without echoing its value` 1/1; `stop-at-first-error` and `append-raw-value` covered by the exact-lines and no-value asserts | J `880f18282` |
| P10-M1.J one 50 MiB policy value | **Opus** (Sol branch did not contain it) | DONE | 4 new cap tests, RED first. Caught: `remove-m4v-extension`, `restore-duplicate-literal`. `report-standalone-cap` and `reject-quicktime` are covered by the exact-message and QuickTime-stored asserts | J `acd56ad16` |
| P10-M5.J description match, DTO, image guidance | Sol, checked by Opus | DONE | 3 Sol witnesses pass; Tovu cut over for the required `mediaMetadataWriteToolId` | J `880f18282`, T `3b9c7d59a` |
| P10-C1.J CLI defs into folders | Sol, checked by Opus | DONE | defs suite 632 pass (631 before, +1 new); `drop-acp-barrel-entry` covered by the new catalog test | J `880f18282` |
| P10-E1.J-b entry env names (HW13) | Opus subagent | DONE | 7 tests. Caught: `return-before-entry-name-check`, `allow-declared-library-read`, `unchecked-indexed-read`. devops 1600/1600 | J `a876a4f0e` |
| P10-E2.T host env at boot | Opus subagent | PARTIAL | 4 tests. Caught: `fall-back-to-3000`, `apply-website-range-to-daemon`, `canonical-loses-to-legacy`, `skip-bracket-and-destructured-reads`. Left: desktop binding (no clean shared import into Electron), daemon origin-policy port injection, and wiring `check:env` (317 undeclared reads today) | T `c749880c0` |
| P10-M2.J codec contract, probe, typed size refusal | Opus subagent | DONE | 3 codec tests + 7 route witnesses. Caught: `infer-from-mime` (twice), `make-probe-error-fatal` (twice), size details dropped or added | J `4fe0f5d68` |
| P10-M3.J ffmpeg converter to agent plugin | Sonnet subagent | DONE | 11 adapter tests plus the restored real ffmpeg round trip (ran and passed here). Caught: `drop-abort-forwarding`, `launch-without-discovery`, `remove-post-process-size-check` | J `a876a4f0e`, why-comments `09cdf5d27` |
| P10-M3.T compose converter per host root | Sonnet subagent | DONE | 2 tests. Caught: `fall-back-to-shell-lookup`, `transcode-at-greater-or-equal`. Note: `installFirstPartyToolContributors` defaults `env = process.env` at the composition root | T `c75b1a13b` |
| P10-M2.T bind policy, persist probe, translate refusals | Opus subagent + Sonnet follow-up | DONE | 4 sheet tests + 4 Library/composer tests. Caught: `cap-video-staging-at-50`, `keep-old-codec`, `infer-hevc-from-mov-extension`, `reuse-50mb-copy-for-video`, plus 4 seam mutations | T `649db96fe`, `fe6ca001c` |
| P10-M4.J neutral media grid route | Opus subagent | DONE | 19 tests. Caught: `trust-workspace-from-input`, `ignore-cursor-scope`, `enrich-lookahead-row` | J `cc9369ace` |
| P10-M5.T store, write, edit descriptions | Opus subagent + Opus fixes | DONE | Migration 0046. Caught: `omit-description-from-saveIfVersion`, `make-description-not-null`, `persist-on-view`, `write-during-image-view` | T `3b9c7d59a`, `76726d3ed`; J fix `3970db0a6` |
| P10-H1.J validate tool output before settlement | Opus subagent | DONE (Jini only; host activation deferred by the sheet) | 4 named + 4 extra tests. Caught: `validation-after-completed`, `include-validation-exception` (2 variants), `validate-decorated-output`, `validate-before-terminal-check` | J `a876a4f0e` |
| P10-H2.J trusted actor attribution | Opus subagent | DONE (`actor` optional on write shapes for now) | Caught on SQLite and PGlite: `stamp-only-change-set`, `default-legacy-kind-to-user`, `strip-actor-kind-on-enqueue`; db 1043/1043 | J `b98334739` |
| P10-H2.T actor-kind migration and origins | Opus subagent | PARTIAL | Migration 0047. Caught on SQLite and PGlite: `infer-kind-from-principal-id`, `enqueue-after-transaction`. `actorForMutation` is not yet bound at writers; the list is in the bugs section | T `16fd5c402` |
| P10-M4.T grid pages without full-list read | Opus subagent | PARTIAL (server done) | 3 tests. Caught: `fall-back-to-repo-list`, `drop-id-tiebreaker`, `filter-after-limit`. Left: admin `listMediaGrid`/`useGridPages`/Load more and its tests, and alphabetical paging, which needs a `0048` sort key | T `8f20205c5` |
| P10-H4.T real assistant-off hold | Opus subagent | DONE (test-only) | 3 named tests pass; 3 routine sub-tests are `todo` because of a real P3 defect. Caught: `clear-hold-on-enable`, `bypass-approval`. `remove-routine-gate` was not applicable: there is no routine gate | T `3247b5123` |
| P10-H5.J scoped discovery | Opus subagent | DONE | 6 tests. Caught: `omit-permission-version`, `omit-workspace`, `mutate-descriptor-in-place`, `fall-back-to-global-catalog`; registry 406/406 | J `510c88673` |
| P10-H6.J outbox subscriber idempotency keys | Opus subagent | DONE | 10 tests. Caught: `use-event-id-alone`, `commit-claim-before-effect`, `derive-key-from-attempt-number`; infra 181/181. Subscriber audit only: none opted in | J `a876a4f0e` |
| P10-M5.T2 index public image descriptions | Opus subagent | PARTIAL | 4 tests. Caught: `omit-description-from-search-text`, `skip-public-eligibility-check`. Left: plain `save`/`replaceFileIfVersion` paths emit no event; whether the outbox write rolls back with the media write is not verified | T `a96cb1525` (landed with C2.T's path-add), `fe6ca001c` |
| P10-C2.J Grok media into provider plugin | Sonnet subagent | DONE (media only) | 2 named tests + removal pins + packaging witness. Caught: `leave-grok-built-in`, `include-imagerouter-row`, and the URL, reverse-alias and env-key re-adds | J `f940fc0c2`, why-comments `09cdf5d27` |
| P10-C2.T mount Grok media, legacy sealed keys | Opus subagent | PARTIAL (credential cutover done) | 4 tests. Caught: `open-legacy-under-new-aad`, `reseal-legacy-ciphertext-in-place`, `clear-canonical-only`, `fall-back-after-canonical-null`; 299/299 across 11 files. Left: admin live Providers catalog and witness `publish-duplicate-card` | T `a96cb1525` |

API baselines: `pnpm api:update` ran once centrally (J `fee5f83e1`). That run also absorbed earlier drift in `@jini-ai/user-management`: 3 react api subpaths were missing from its baseline before this branch. Every Jini sheet has a changeset.

## Gates vs merge-21

| gate | merge-21 | b-g5b |
|---|---|---|
| Tovu `apps/desktop npm run gates` | 6/6 PASS | 6/6 PASS (final tree `70915fc0a`) |
| Jini packages build | 0 | 0 |
| Jini `pnpm typecheck` (strict) | — | 0 |
| Jini `api:check` | drift (user-management) | 0 |
| Jini `guard` | — | 1 new HW3, in `packages/admin/src/shell/lib/shell-failure-log.ts`: untouched by this branch, so not from this branch. No Tovu or host words added to Jini. |
| Jini why-comments (base merge-21) / hooks | — | ok / ok |
| Jini complexity ratchet | already red (`readOriginalVideo`, `refusalError`, `ErrorNotice`, `prepareTermSync` before any edit) | 11 entries, none in a file this branch changed except `readOriginalVideo` (which already existed; only its line moved) |
| Jini changed test files (12 packages) | — | 591/591 |
| Tovu `tsc` / admin `tsc` | 0 / 0 | 0 / 0 |
| Tovu `check:hooks` / `check:boundaries` | ok / 0 errors | ok / 0 errors (143 warnings) |
| Tovu `check:why-comments` (base merge-21) | — | ok (2 restored) |
| Tovu `check:complexity` | — | 4 new entries, all in files this branch did not change |
| Tovu `check:size` | — | none of this branch's files listed after `70915fc0a` (Media.tsx, two media hooks and assistant-byok extracted). Remaining Worsened entries are in files this branch did not change (PageEditor, use-page-editor, use-post-editor, panels.tsx, desktop, site-assistant) |
| Tovu node tests on changed files (28 files) | — | 506 tests: 488 pass, 3 todo, 15 fail. All 15 fail on merge-21 too: 12 in media repo contract/restart, where the merge-21 fixture lacks `captions: null` and the repo returns it; 2 in serve-command-wiring, whose source pins went stale when listen moved to `serve-listen.ts`; and `tool-registrations.contracts.test.ts`, which imports the missing `features/mail-status/delivery-agent-tools.js` |
| Tovu admin vitest on changed files | — | 218/218 |

Not run as a whole: the full Tovu website node suite (combine-21 found about 255 red files there) and the full Jini vitest for every package. Each subagent ran its own package's full suite; those results are in the table above.

## UNVERIFIABLE-IN-CLOUD

- Live Postgres: the `ops.postgres`/`runner.postgres` tests, the lockKey and concurrent-upgrade tests, and the Postgres parity/manifest tests fail here because no server is running. 0046 and 0047 are verified on SQLite and PGlite only.
- The real ffmpeg/ffprobe codec probe on real phone HEVC `.mov` files. The ffmpeg round trip ran, but the codec probe was tested with fakes.
- The xAI media plugin generating against the real xAI API, and a real previously sealed `grok` key on a real desktop profile (tested with real AAD envelopes in memory).
- Boot env validation in the packaged desktop app, and `tovu serve` with a real `config.json` port plus a bad `PORT`.
- The admin Chrome-playback note and the translated 50 MB copy in a real browser.
- Daemon HTTP attachment-upload characterization: 15 tests fail with 500. The daemon diff only touches the tool executor and core changes are type-only, so these failures are not from this branch, but this was not confirmed against a merge-21 build.

## Bugs

**Fixed:**
- `g5b-postgres-schema-hand-edited`: merge-21's generated `schema.postgres.ts` had hand-added 0044 lines, so the drift test was red. The file is regenerated; the comments stay in `schema.sqlite.ts`.
- `g5b-media-description-dropped-by-jini`: the PATCH parser, the import/generate tool schemas and admin `MediaMetadataPatch` dropped `description`. Fixed test-first; 6 mutations caught (J `3970db0a6`).
- 8 Jini and 2 Tovu why-comments lost in moves, restored verbatim. This also restored the real ffmpeg round-trip test.
- The `scripts/__tests__/check-env-access.test.ts` spy used `console.log`, but the logger writes with `console.info`.

**Logged in `development/open-bugs.md`:**
- `g5b-agent-routine-runs-while-assistant-off`: an agent routine still runs while the assistant is off. There is no routine gate, and Jini `Routine` has no creator kind. Owner: P3 lane.
- `g5b-stale-env-access-debt-rows`: 2 stale HW9 debt rows already present on merge-21.

**Open follow-ups (not bugs in shipped behaviour):**
- H1 host activation.
- H2: make `actor` required, add system kind (Jini `CommandActor` widening), widgets/taxonomy writers, and bind `actorForMutation` at writers.
- E2: desktop binding and `check:env` wiring.
- M4.T admin half and alphabetical paging (0048).
- M5.T2 plain-save and purge paths.
- C2.T admin live catalog.
- `readDeclaredEnvKey` lives in devops; move it to a runtime package and adopt it in `mcp serve`.
- The provider-plugins observability OTel/Sentry tests time out here (4, network); not checked on merge-21.
- `assistant-byok.inputs-pin.test.ts` "BYOK automatic preflight keeps the prompt and logs a redacted cause" fails: the test calls `appendAutomaticPluginGuidance` (untouched here) with positional arguments. Looks older than this branch; not checked on merge-21.

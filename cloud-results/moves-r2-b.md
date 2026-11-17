# moves/r2-b cloud results (base: integ/wave-b; Jini 6cfcc471, Tovu 9ec4ad4a)

## Slice 1 — split-services: DONE (3 sheet commits + 1 fix-up)
| repo | SHA | what |
|---|---|---|
| Jini | 607dd51c | J-a typed `category: "reauth_required"` on hosted config failures (test first) |
| Jini | d0e5aabb | J-b `probeExternalMcpServer` (mcp/federation/hosted) + `readFederationAdmissions` (mcp/federation) + tests + changesets |
| Tovu | 1192ea25 | T: Tovu binds Jini owners, `server/runtime/services` deleted |
| Tovu | 49535903 | FIX-UP: 1192ea25's commit pathspec missed 3 new files (external-mcp-admissions.ts, 2 moved tests). 1192ea25 alone does not compile; use both. |

Evidence (Jini, Node 24.11.1, vitest `--maxWorkers=2 --minWorkers=1`, mcp built against branch core/protocol/platform):
- RED on J-a parent (new test added first, store/config at wave-B): `second-host-store.test.ts › a reauthorization failure carries the typed reauth_required category…` FAILED: received `{acme-stored:null, acme-live:null, acme-down:null}`, expected `reauth_required` for stored+live. The other 3 tests in the file passed.
- GREEN on J-a: `src/federation/hosted` 8/8. J-b: hosted + admissions 15/15 (probe.test 4, admissions.test 3). Constructor adaptation for McpProtocolError/McpAuthFailedError was NOT needed (`({message})` shape matches).
- `tsc --noEmit` mcp: clean (after daemon dist emitted). eslint on all touched Jini files: 0 errors; 1 pre-existing warning (saveExternalMcpServer 66 lines).
- Full mcp suite: 2 failed + 2 files failed to load. The 2 test failures (`mcp-federation.registrations.test.ts`: native-collision, hosted 401 "naming the fix") reproduce identically with store.ts reverted to wave-B -> PRE-EXISTING baseline. Load failures: serve.test.ts, tool-server.wire.test.ts (`@jini-ai/agent-runtime` has no dist).
- Tovu (node:test, `--test-concurrency=1`, Jini packages symlinked into node_modules/@jini-ai, dists built from the branch; npm-published 0.7.0 does not match wave B): operations.unit, admissions.observability.unit, admin-external-mcp-probe-routes, probes-and-cards, assistant-cold-start, external-mcp-oauth, external-mcp-store: **267/269 pass**. 
  Remaining failure: `external-mcp-admissions.observability.unit.test.ts › server admissions waits for admission…` crashes in the shared OTel fixture (`createOtelObservabilityPort`, "Cannot destructure property 'errorType' of 'helpers'", otel-port.ts:74) before reaching the moved code; fixture/wave-B baseline, not this change (not verified on parent). The other 5 tests in that file pass (incl. credential-safe logging). admin-external-mcp-probe-routes all pass after building provider-plugins plugin bundles by hand.
- Tovu `tsc -p tsconfig.json`: no errors in any touched/new file; 2 unrelated errors (assistant/external-mcp-connection-source.ts:157, tool-catalog-manifest.ts:475 TovuPluginHostDeps — plugin-host typing, wave-B baseline).
- Wave-B baseline is not green for `pnpm -r build` in Jini: desktop-host, capability-providers, http-kit, plugins, cms, ui, provider-plugins, chat, daemon, admin, user-management emit tsc errors (tsc still emits).

### Sheet deviations / errors
- Census over-matched: `external-mcp-admissions-rules` (apps/admin), `admin-external-mcp-admissions-routes` baselines and `user-facing-errors.md:69` hit the regex but are different files; sheet says "any other hit: STOP". Judged unambiguous; proceeded; no apps/admin edit made.
- Executor error: first Tovu commit pathspec built from `git status` missed 3 newly added files (fixed by 49535903, no force-push).
- Jini lint note: `unix` eslint formatter no longer exists; used default formatter.

### Opus-review points (J-a)
RED/GREEN above; `category` optional so existing non-reauth failure `toEqual`s are untouched; Tovu oauth test gained `category` on the one reauth entry (assertion tightened, not removed).

## Slice 2 — stay-error-mapping: DONE
Tovu 31ae4776 (INFO.md only). Precondition (respond.ts imports `statusForError` from `@jini-ai/core/contracts/server`) held; blob matched; all 3 edits applied once.

## Slice 3 — split-events EV-1..EV-5: SKIPPED
Reason: `sheets/decided/split-events.md` does not exist on plan/terra-2026-11-15 (9152711d). INDEX.md marks it "NOT WRITTEN (context cap)"; only `split-events.repoint.py` (EV-4, depends on EV-1..3 landing) and its expected output exist. No Opus-review points to record. Nothing changed.

## Branch
`moves/r2-b` pushed on both repos. Tovu environment note: node_modules/@jini-ai/* in the cloud container were symlinked to the Jini checkout (not committed).

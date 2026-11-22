DONE <sha>

# RT-K1-0.J (Jini half) — route refusal, body cap, returned-vs-thrown error parity

Branch `codex/ex2-rt-k1-0-jini`, based on `origin/integ/merge-13-2026-11-22` @ `7c4ee7881`.
Spec read: `plans/P9-steps/RT-K1-0.md`, `plans/P9K-fix-B1-B3.md` §`RT-K1-0.J` (wins), `plans/P9K-fixcheck-B1-B3.md`
(NEEDS applied: move range `settings/shared.ts:156–174`, incl. the disclosure comment and closing brace),
`plans/P9-extraction.md` §1, `plans/P9F-check.md` Blockers bullet 1. Tovu source read at `integ/merge-13-2026-11-22` (f9d2f0226).

## Commits (all pushed)
- `c0be502a` wip(core,cms): route refusal (test first) and content-entry body cap
- `134f0ade0` wip(core): returned route failures take the thrown ClientFacingError path; export payloadTooLargeError
- `989344e96` wip(http-kit): returned parse/handle failures and the maxBodyBytes 413 reach onError like a thrown refusal
- `9c154f411` chore(api): changeset and core/cms/http-kit api-baseline delta
- this report commit (SHA on the first line)

## Files moved / added
| What | From (Tovu) | To (Jini) |
|---|---|---|
| `SettingsRequestError` → `RouteRefusalError`, `rejectSettingsRequest` → `rejectRoute` | `apps/website/.../routes/settings/shared.ts:156–174` (disclosure comment, class, JSDoc, function, closing brace) | `packages/core/src/contracts/server/route-refusal.ts` |
| `CONTENT_ENTRY_MAX_BODY_BYTES` + its doc + the SPEC-002 1 MiB rationale | `apps/website/src/server/inbound/shared/body-size-limit.ts:7-9,25-26` | `packages/cms/src/admin-http/limits.ts` |

Verbatim except: names (sheet), "Tovu's flat JSON envelope" → "the host's flat JSON envelope", "other errors use CMS mappings" → "other errors use the host's error mappings" (host-neutral wording), an `@file` header.
Preserved: `response: { status, body }`, inherited `name === "Error"`, message `"settings request rejected"`, absent `code`/`details` omitted, the `_optional: Record<string, never> = {}` pad.
The Express re-measure rationale in body-size-limit.ts's header stays with Tovu's middleware (it explains Express middleware, not the constant).

Added (behaviour change, tests first — dispatch + P9F-check Blockers bullet 1):
- `packages/core/src/contracts/server/json-route.ts`: `refuseReturned` — a returned body-read failure (413 cap, 400 bad JSON, 415), parse `err` or handler `err` now throws `ClientFacingError({ apiError })` into the route's existing catch. With `ports.onError` the port receives it (previously bypassed); without, the existing `ClientFacingError` branch answers the identical status/body as before.
- `packages/http-kit/src/adapter.ts`: same `refuseReturned` for parse/handle `err`; new `refuseOversizedBody` enforcing optional `JsonRouteSpec.maxBodyBytes` (non-GET; re-measures the parsed body exactly like `rejectOversizedJsonBody`, refuses with core's 413 `PAYLOAD_TOO_LARGE` through the same path). `defineJsonRoute` optional args accept `maxBodyBytes` (as core's already did).
- `packages/core/src/contracts/server/request-body.ts`: exported `payloadTooLargeError({ maxBytes })` (wraps the existing private `tooLarge`, so both adapters refuse with one code/message).
- No Express adapter added; Express stays behind http-kit's existing adapter. No new port.

## Exports + api-baseline delta
- `@jini-ai/core` `./contracts/server`: **+** `RouteRefusalError` (class), `rejectRoute` (function), `payloadTooLargeError` (function). Barrel line: `export { RouteRefusalError, rejectRoute } from './server/route-refusal.js';` (`payloadTooLargeError` flows through the existing `export * from './server/request-body.js'`).
- `@jini-ai/cms`: **+** entry `./admin-http/limits` (universal, dist triple, `jini.entries`) with `CONTENT_ENTRY_MAX_BODY_BYTES`. CMS has no `typesVersions`.
- `@jini-ai/http-kit` `.`: `JsonRouteSpec` and `defineJsonRoute` hashes changed (additive optional `maxBodyBytes`).
- Changeset `.changeset/p9k-rt-k1-0.md`: core minor, http-kit minor (onError now also sees returned failures), cms patch.

## Tests
New:
- `packages/core/src/contracts/server/__tests__/route-refusal.test.ts` (4) — written first, red (3 × "instanceof needs a constructor"), then green.
- `packages/core/src/contracts/server/__tests__/json-route.test.ts` +7 — body cap 413, malformed JSON, returned parse err, returned handle err, thrown ClientFacingError all reach `onError` as one `ClientFacingError` and answer with the port's envelope; thrown `RouteRefusalError` answers the port's exact body; no-port returned err ≡ thrown ClientFacingError. Red first: 4 failed / 21 passed, then 25/25.
- `packages/core/src/contracts/server/__tests__/request-body.test.ts` +1 — `payloadTooLargeError` is exactly readJsonBody's refusal.
- `packages/http-kit/src/__tests__/adapter-error-parity.test.ts` (10) — same matrix on Express incl. `maxBodyBytes` (over cap → 413 before parse; at cap → 200). Red first: 6 failed / 4 passed.

Changed (pinned the superseded behaviour the dispatch asked to change — assertions replaced, none weakened; each split into with-port and no-port cases):
- `http-kit/.../adapter-ports.test.ts`: "keeps parser Result errors on the standard API envelope" (asserted `onError` NOT called) → "hands parser Result errors to the host error port as a ClientFacingError, without handling" + "keeps parser Result errors on the standard API envelope when the host has no error port".
- `http-kit/.../adapter-pins.test.ts`: "serializes a %s Result failure without invoking the host exception port" → "hands a %s Result failure to the host exception port as a ClientFacingError" + "serializes a %s Result failure on the standard envelope without a host exception port".

Full suites (final tree):
- core: 217 files, **2983 passed** / 0 failed
- http-kit: 39 files, **763 passed** / 0 failed (was 759+2 failing pins before the pin update; net +12 tests vs base 751)
- cms: 431 files, 5012 passed / **9 failed — pre-existing**: the same 4 files (forms `package-boundary`, `create-tables.reference` [pglite, load-dependent], `result-html` ×6, widgets `expand-partials` ×1) fail identically with `packages/cms` reset to base (8 failed / 10 passed run in isolation both ways). Unrelated to `admin-http/limits`.

## Mutation
- Named (sheet): `rejectRoute` drops `code` from the body (`if (required.code !== undefined) body.code = ...` removed) → `route-refusal.test.ts`: **1 failed | 3 passed** ("carries the exact response for a 403 with code and permission details"). Restored → 4 passed; `git status` clean.
- Extra: http-kit `sendRouteResult` back to direct `sendApiError` for a returned `err` → `adapter-error-parity.test.ts`: **1 failed | 9 passed** ("hands a returned handler error to ports.onError…"). Restored clean.

## Gates (base = unmodified 7c4ee7881 worktree; final = branch)
| Gate | base | final | new red from this step |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | — | ok | — |
| `pnpm -r build` / changed pkgs rebuilt | — | ok | — |
| `pnpm typecheck` (all packages + scripts) | — | **EXIT 0** | none |
| `pnpm guard` | 1 (base worktree had no dist: 8 unresolved-module noise) | **0** | none |
| `check:size` | 1 | 1 | none (identical output; no touched file listed) |
| `check:complexity` | 1 | 1 | none (identical output) |
| `check:hooks` | 0 | 0 | none |
| `check:why-comments` | 1 | 1 | none (same 10 unallow-listed blocks; none in touched files) |
| `check:errors` | 0 | 0 | none |
| `check:cross-package` | 1 | 1 | **XP4 on `route-refusal.ts` (+3 lines) and its test** — see findings |
| `pnpm api:update` | — | 3 baselines updated | additive only |

Touched-file check for cross-package: json-route.ts 21/21, request-body.ts 9/9, server.ts 15/15, http-kit adapter/types 1/1 (env `JINI_DECLARATION_BASELINE_DIR` noise) — unchanged.

## For the Tovu half (`RT-K1-0.T`)
Exact specifiers:
```ts
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/contracts/server";
import { CONTENT_ENTRY_MAX_BODY_BYTES } from "@jini-ai/cms/admin-http/limits";
import { ClientFacingError } from "@jini-ai/core/contracts/server"; // for onError mapping
```
- `RouteRefusalError` is a drop-in for `SettingsRequestError` (`.response.status`, `.response.body`, same message, `name === "Error"`); `rejectRoute` is a drop-in for `rejectSettingsRequest` (same arguments and pad).
- **New onError contract (both `@jini-ai/http-kit` `mountJsonRoute` and core `jsonRoute`)**: with `ports.onError`, returned parse/handle `err`s, the `maxBodyBytes` 413 (and on the Web adapter the 400 bad-JSON / 415 encoding refusals) arrive at `onError` as `ClientFacingError` (`.apiError: { code, message, ... }`). `adminJsonRoutePorts.onError` / `publicJsonRoutePorts.onError` must map `ClientFacingError` to the flat envelope (`res.status(statusForError({ error: e.apiError })).json({ error: e.apiError.message, code: e.apiError.code })` or the host's existing copy), `RouteRefusalError` to `res.status(e.response.status).json(e.response.body)`, else `sendAdminFailure` / `reportServerFailure`. Settings' current `respondToSettingsError` fallback would otherwise receive `ClientFacingError`s (today unreachable: settings `parse` always `ok`, `handle` always `ok`).
- Express `maxBodyBytes`: http-kit `defineJsonRoute(required, { maxBodyBytes: CONTENT_ENTRY_MAX_BODY_BYTES, ports })` now enforces the cap (non-GET, measured as `Buffer.byteLength(JSON.stringify(req.body ?? {}))`, same as `rejectOversizedJsonBody`) and the 413 goes through `onError`. Until a route moves onto `defineJsonRoute`, keep `rejectOversizedJsonBody` (fix-B1 note) — its own `errorResponseFactory` body is unaffected.
- The cap check runs right after reading input and **before** the `workspace` port (mirrors core, where the body read precedes `workspace`).
- Tovu still owns the Express middleware file and its re-measure rationale header; only the constant moves.

## Minor findings (listed, not fixed)
1. `RouteRefusalError`'s message is still `"settings request rejected"` (preserved per spec) — settings-flavoured text in a generic class; it never reaches the wire.
2. `check:cross-package` XP4: `core/src/contracts/**` is expected to be runtime-free, so the sheet-mandated `contracts/server/route-refusal.ts` (+ test) adds XP4 lines. Every sibling in `contracts/server/` (json-route, request-body, api-error, origin, …) already trips XP4, so this matches the established pattern; the owner may want a debt entry or a different home.
3. Same-origin refusals (403 `cross-origin request rejected`) still bypass `onError` in both adapters (written directly via `passesSameOriginGuard` / `errorAnswer`). Not one of the four named cases; a flat-envelope host using `requireSameOrigin` would see the standard envelope there.
4. `refuseReturned` is duplicated (core json-route.ts and http-kit adapter.ts, 3 lines each) to avoid widening core's API.
5. `route-refusal.ts` keeps the source's double quotes (verbatim) while core uses single quotes; `RouteRefusalError`'s constructor keeps its positional `readonly response` parameter (verbatim).
6. Pre-existing cms failures (forms package-boundary, result-html ×6, expand-partials ×1, pglite DDL under load) and pre-existing size/complexity/why-comments reds on base are unchanged.
7. Gate tooling: base worktree had no `dist/`, so base `guard`/`check:cross-package` logs carry ENOENT/unresolved noise; comparisons above are per touched file.

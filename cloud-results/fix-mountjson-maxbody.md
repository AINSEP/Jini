DONE 5c34cde1c

# fix-mountjson-maxbody — Jini http-kit `mountJsonRoute` ignored spec `maxBodyBytes`

Branch `codex/fix-mountjson-maxbody`, from `origin/integ/merge-14-2026-11-22`.
Read `AI-Dev-Shop/agents/programmer/skills.md` before starting (followed: RED first, smallest fix, mutation check, regression suites, why-comments).
The `DONE` SHA above is the last code commit. This report goes in one commit after it (see `git log`).

## Root cause
- http-kit's own `JsonRouteSpec` (`packages/http-kit/src/types.ts`) had no `maxBodyBytes` field, and `mountJsonRoute`
  never read one. A Core `defineJsonRoute` spec that set the field mounted without error, and the field was ignored.
  The host's `express.json()` limit was the only limit that applied.
- Same kind of drop in `packages/daemon/src/http/route-table.ts` `gatedJsonRoute`: `{ ...spec, maxBodyBytes: host.jsonBodyMaxBytes }`
  replaced a tighter spec cap with the host's limit.

## Fix
- `packages/http-kit/src/adapter.ts`: new `allowRouteBody` (about 10 lines, complexity 4) runs right after `rawInput`,
  in the same place Core's `jsonRoute` reads the body (before workspace, origin and auth).
  It measures the body Express already parsed: raw bytes and strings as they are, objects re-serialized as JSON.
  Core's `jsonRoute` measures the same bytes when it runs behind `node-bridge`, so the two mount paths agree.
  Over the cap, it answers 413 with Core's plain-words refusal. GET and HEAD are exempt, as in Core.
  It uses `TextEncoder`, not `Buffer`, and adds no dependencies.
  http-kit's `JsonRouteSpec` and `defineJsonRoute` now accept `maxBodyBytes`.
- `packages/core/src/contracts/server/request-body.ts`: exports `payloadTooLargeError({ maxBytes })` so all paths use the same wording. This is an additive change.
- `packages/daemon/src/http/route-table.ts`: `maxBodyBytes = min(spec ?? host, host)`.
- Changeset: `.changeset/fix-mountjson-maxbody.md` (patch: http-kit, core, daemon).

## A spec cap larger than the host default: **clamped**
Core's contract doc says `maxBodyBytes` is the "Body ceiling … Defaults to the shared JSON body limit."
In the Express host, `express.json()` reads the request before any route runs, so a route can only make the limit tighter.
The daemon already had a test for this rule ("limits the body to the host's limit, not the spec's").
The new tests pin the same rule on both paths.

## Tests (new)
`packages/http-kit/src/__tests__/adapter-body-limit.test.ts` (real Express app, real socket, `express.json({limit:1024})` in front):
1. refuses a body over the spec cap with 413 and the plain-words refusal, before the handler runs
2. answers a body at or under the spec cap
3. keeps the host default when the spec declares no cap
4. clamps a spec cap larger than the host default to the host default
5. measures a raw bytes body by its own bytes
6. measures a text body by its own bytes
7. carries maxBodyBytes through http-kit's own defineJsonRoute

`packages/daemon/src/http/__tests__/route-table.test.ts`:
- keeps a spec's maxBodyBytes that is tighter than the host's limit (413, exact `PAYLOAD_TOO_LARGE` envelope, under-cap 200)
- uses the host's limit when the spec declares none

## Red → green evidence
- http-kit, at commit b6dc71b54 (test only): `× refuses a body over the spec cap … → expected 200 to be 413`. 1 failed, 4 passed.
  After the fix: 5/5 passed. Later grew to 7/7 with the raw and text cases.
- daemon, test added before the fix: `× keeps a spec's maxBodyBytes that is tighter … → expected [200, {n:123456789}] to deeply equal [413, …]`. 1 failed, 7 passed.
  After the fix: 8/8 passed.

## Named mutations
- http-kit: `const maxBytes = spec.maxBodyBytes` → `undefined` (spec-cap lookup dropped): **red** (test 1 fails: 1 failed, 4 passed). Restored: green.
- daemon: `Math.min(spec.maxBodyBytes ?? host…, host…)` → `host.jsonBodyMaxBytes`: **red** (the "tighter" test fails: 1 failed, 7 passed). Restored: green.

## Other paths checked
- `packages/core/src/contracts/server/json-route.ts` `jsonRoute`: **no drop.** `readRawInput` passes `spec.maxBodyBytes` to `readJsonBody`. Its existing test `reads no body for GET and enforces maxBodyBytes` already covers this.
- `packages/server/src/route-host.ts`: **no spec involvement.** It only supplies `jsonBodyMaxBytes` (the parser limit × 5.25, the maximum re-serialization growth) to the daemon route host.
- `packages/daemon/src/http/route-table.ts` `gatedJsonRoute`: **drop found, fixed and tested** (above).
- `packages/daemon/src/http/tool-execution-routes.ts`: its own `maxBodyBytes` option is passed straight to `readJsonBody`. It is not a spec field, so nothing is dropped.
- No existing daemon route spec declares `maxBodyBytes`, so the daemon clamp changes no live route's behaviour today.

## Verify (final tree)
- `pnpm install --frozen-lockfile`: OK. `pnpm -r build` baseline: EXIT 0.
- Build of core plus the dependents of http-kit and daemon: EXIT 0. `pnpm typecheck`: EXIT 0. `pnpm guard`: EXIT 0 ("zero violations").
- vitest: http-kit 39 files / 757 tests passed; core 219 / 2978 passed; server 31 / 469 passed (1 skipped, already skipped before this change); daemon `src/http` 67 / 2169 passed.
- Note: the first typecheck after the fix failed in the new test only. Core's `ports` type does not match http-kit's, and the test passed a Core spec straight to `mountJsonRoute`. Fixed in 5c34cde1c by removing `ports` (unset) before mounting.
  This also shows that a Core spec *with* `ports` cannot be typed straight into the Express mount. That is a known difference between the two port shapes, not part of this bug.

## Architecture audit: PASS
http-kit stays the Express adapter. Core gains one framework-free helper. There are no new dependencies, and the boundary guard is clean.

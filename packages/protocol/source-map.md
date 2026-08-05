# `@jini/protocol` — provenance

Origin: `nexu-io/open-design` (fork `leonaburime-ucla/open-design`), branch `main`,
commit `951fa5f1541c3b7af23ccb07e3e60b294def56b1` (2026-07-12), local reference
clone `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic`.

Per extraction-plan.md §8 task 2: "`@jini/protocol` — run events/errors/cursors/
cancellation/idempotency, seeded from `packages/contracts` with OD nouns stripped."

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/common.ts` | `packages/contracts/src/common.ts` | Verbatim generic shapes (`JsonValue`, `BoundedJsonConstraints`, `OkResponse`, `IdResponse`, `EntityResponse`, `EntityListResponse`, `Nullable`). Dropped `LIVE_ARTIFACT_BOUNDED_JSON_CONSTRAINTS` (a product-specific constant value) — packs supply their own values against the generic interface. |
| `src/errors.ts` | `packages/contracts/src/errors.ts` | Kept the generic error envelope (`ApiError`, `ApiErrorResponse`, `ApiValidationIssue`, `ApiValidationErrorDetails`, `createApiError`, `createApiErrorResponse`) and only the transport/tool-boundary-generic codes from the ~80-entry `API_ERROR_CODES` union (renamed `GENERIC_ERROR_CODES`). Dropped every product code (`AMR_*`, `ARTIFACT_*`, `CONNECTOR_*`, `MEDIA_*`, `LIVE_ARTIFACT_*`, `PROJECT_NOT_FOUND`, `ROLE_MARKER_HALLUCINATION`, `TOOL_LOOP_DETECTED`, etc.) and widened `ApiErrorCode` from a closed union to `GenericErrorCode \| (string & {})` so a pack's own codes type-check without a kernel edit. Dropped the OD-shaped `taskId` field on `ApiError` (collides with the automation-domain `WorkItem`/`JobAttempt` vocabulary — see the vocabulary firewall in root `AGENTS.md`). Renamed `SseErrorPayload` → `RunErrorPayload` (transport-neutral). |
| `src/events.ts` | `packages/contracts/src/sse/common.ts` + the generic slice of `packages/contracts/src/sse/chat.ts` | `SseTransportEvent<Name, Payload>` → `RunEvent<Name, Payload>` (renamed off "SSE" — SSE is one transport projection among HTTP/CLI/MCP/sidecar per §12 C2). Kept the generic run lifecycle payloads (`start`/`stdout`/`stderr`/`error`/`end`, and the `agent` sub-payloads `status`/`text_delta`/`thinking_start`/`thinking_delta`/`tool_use`/`tool_input_delta`/`tool_result`/`usage`/`raw`). Dropped OD/pack-shaped payloads: `conversation_title`, `fabricated_role_marker`, `tool_loop` (gated by OD's `OD_TOOL_LOOP_GUARD`), `live_artifact`/`live_artifact_refresh`/`artifact` SSE payloads, `browser_action_request` (depends on OD's `agent-tools` capability vocabulary). Dropped daemon-internal fields on the start payload (`cwd`, `projectId`, `model`, `reasoning`, `bin`) — kept `runId`/`agentId`/`protocolVersion`/`idempotencyKey`. These dropped shapes are exactly the kind of thing a pack layers on top of the same `RunEvent` envelope; they are not lost, just not kernel-owned. |
| `src/run.ts` | `packages/contracts/src/tasks.ts` | `TASK_STATES`/`TaskState`/`TaskStatus` → `RUN_STATES`/`RunState`/`RunStatus` (renamed off "Task" — that word is reserved for the automation domain's `WorkItem`/`JobAttempt`, not the engine's `Run`; see the vocabulary firewall). Added `TERMINAL_RUN_STATES`/`isTerminalRunState` and `RunCancelRequest` (new, not lifted — extraction-plan task 2 calls for an explicit cancellation contract that the origin file didn't have). |

Explicitly not ported here (still OD-only / later-task material): `execution-profile.ts`
(product-specific run mode), `agent-tools/*` (capability/tool vocabulary — task 6
`ToolExecutor` territory), everything else in `packages/contracts/src/index.ts`'s
barrel (`api/*`, `brands`, `plugins`, `figma`, `media`, `connectors`, `design-systems`,
`prompts`, `critique`, `analytics`, `artifacts/od-card`) — all product surfaces per
`ADS-memory/reports/jini-port/recon/r1-daemon.md`.

**Provenance correction (2026-07-16):** the origin commit above is the tip of
the local `open-design-agentic` clone's `main` branch, which turns out to be a
personal integration branch diverged from true upstream `nexu-io/open-design`
`main` (see `ADS-memory/reports/jini-port/od-reference-branches.md`), not upstream `main`
itself. Practical effect on this file: `GENERIC_ERROR_CODES` includes
`TOOL_NOT_AVAILABLE`, which is only present in the local branch's
not-yet-upstream `browser-actions`/`agent-tools` work — `common.ts` and the
rest of `errors.ts`'s kept codes are verified byte-identical to true upstream.
Not reverted; it's a reasonable generic tool-boundary code either way.

## Addendum: `registry.ts` (2026-07-17)

Sourced from `leonaburime-ucla/open-design`'s `packages/registry-protocol`
(cloned fresh to `/tmp/od-source` for this task; `src/schemas.ts` +
`src/backend.ts` + `src/index.ts`, 3 files, ~199 LOC total), per
`ADS-memory/reports/jini-port/recon/r2-packages.md` §14: "zero OD coupling... pure zod
schemas... Classification: PURE-TS. Drop-in." Verified independently before
porting: `grep -niE "open[- ]design|OD_"` across all three source files and
the package's own test file returned zero matches.

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/registry.ts` | `packages/registry-protocol/src/schemas.ts` + `src/backend.ts` | Combined into one file (the origin split schemas/backend across two files for its own build reasons — an `esbuild` CJS/ESM dual-publish setup this package doesn't share); every schema, inferred type, and the `RegistryBackend`/`RegistryBackendFactory` interfaces ported verbatim, zero renames, zero dropped fields. Folded into the existing file-per-domain barrel convention (`run.ts`/`events.ts`/`errors.ts`/`common.ts`) rather than a separate package — per the task brief, ~199 LOC of pure wire-type schemas doesn't justify its own build/publish surface, and it is "the same *kind* of thing protocol already holds." |

Added as a new file inside the **existing, already-locked** `@jini/protocol`
package (extraction-plan.md §3) — unlike the `@jini/deploy`/`@jini/diagnostics`/
`@jini/metatool` situations elsewhere in this porting effort, this addition
needs no separate sign-off: it doesn't create a new package or expand the
locked §3 package set, it only adds one file's worth of exports to a package
whose charter ("pure wire types... + token TYPE decls") already covers this
content by kind.

**Dependency added:** `zod` (`^3.25.76`, matching the origin package's pinned
version) — `@jini/protocol`'s existing four files (`common`/`errors`/`events`/
`run`) are hand-written plain TypeScript interfaces with no runtime schema
validation; this is the first file in the package to use zod, so it is now a
real runtime dependency of `@jini/protocol` (previously the package had none).

**Not ported:** `packages/registry-protocol/esbuild.config.mjs` (build
tooling specific to the origin package's own separate-publish setup — this
package builds via the shared `tsc -p tsconfig.json` convention every other
`@jini/*` package uses, per the task's package.json/tsconfig.json template
instruction) and `tsconfig.tests.json` (a second tsconfig the origin needed
only because its `tests/` directory lives outside `src/`; this port's test
file sits beside its source file, matching every other file in this package,
so no second tsconfig is needed).

## Addendum: `ResolvedRegistryEntrySchema.verified`/`verifiedIssuer`/`verifiedSubject` (2026-07-21)

Implements decision 2 of
`ADS-memory/reports/proposals/PROP-registry-signature-trust-verification-2026-07-21.md`
(human/architect sign-off already recorded there) as part of `@jini/registry`
gaining a real `github-oidc` signature verifier (`packages/registry/src/trust.ts`
— see that package's own source-map.md's 2026-07-21 addendum for the full
design/research trail). This is a `@jini/registry`-authored change to a
`@jini/protocol` schema — allowed under this task's explicit scope, since the
per-entry-verified-trust decision is a protocol-layer question the registry
package's own boundary can't resolve on its own (per the proposal's own §3
open question).

`ResolvedRegistryEntrySchema` (`src/registry.ts`) gains three fields,
inserted alongside the existing `trust: RegistryTrustSchema` field:

```ts
verified: z.boolean().default(false),
verifiedIssuer: z.string().optional(),
verifiedSubject: z.string().optional(),
```

**Purely additive — `trust`'s own meaning and every existing caller's
behavior is byte-identical to before this change:** `verified` defaults to
`false` via zod's `.default()`, so `.parse()`-ing a pre-existing
`ResolvedRegistryEntry`-shaped object that has never heard of this field
still succeeds (never throws) and yields `verified: false` — matching
exactly what every backend already did before this task (no per-entry
verification existed at all). `trust` is not renamed, narrowed, derived from,
or otherwise touched by this change; a caller that only reads `.trust` sees
nothing different. `verifiedIssuer`/`verifiedSubject` are plain optional
strings (flat siblings of `ref`/`integrity`/`manifestDigest`, matching this
schema's existing style — no new nested schema type introduced), present
only when `verified` is `true`.

**TypeScript note:** because `verified` uses zod's `.default()`, the
*inferred output type* (`z.infer<typeof ResolvedRegistryEntrySchema>`, what
`ResolvedRegistryEntry` resolves to) requires `verified: boolean` on any
object literal typed as `ResolvedRegistryEntry` — this is `.default()`'s
normal zod behavior (the input type makes it optional, the output/parsed
type does not, since parsing always fills it in) and only affects code that
*constructs* such an object (every concrete backend's `resolve()`, and this
package's own `registry.test.ts` mock `RegistryBackend`), not code that only
*reads* an already-resolved entry's `.trust` field.

**Tests:** `src/__tests__/registry.test.ts` — one new test parses both
"no `verified` supplied" (asserts default `false`, `trust` unaffected) and
"`verified: true` with `verifiedIssuer`/`verifiedSubject` supplied" (asserts
`trust` is still whatever the backend configured, proving the two fields
don't interact); the pre-existing inline `RegistryBackend` mock's `resolve()`
was updated to supply `verified: false` to keep compiling under the
TypeScript note above.

**Verification:** `pnpm --dir packages/protocol build` clean (registry
depends on this package's dist — built first). `pnpm --dir packages/protocol
exec vitest run` — 11/11 passing (up from 10/10). No other `@jini/*` package
currently consumes `ResolvedRegistryEntry` besides `@jini/registry` itself
(repo-wide grep before this change), so no other package needed updating.

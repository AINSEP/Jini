# `@jini-ai/a2ui` — provenance, scope, and adversarial-testing report

A "build-then-break" task: A2UI (a2ui.org, v1.0) had **zero implementation** anywhere in this repo
before this task. This package is a from-scratch port of the real, versioned, actively-maintained
A2UI wire protocol, plus a minimal client-side interpreter, plus a live fixture in
`examples/reference-web` (`#/a2ui-lab`) wired to a real daemon run.

## Primary sources (fetched and read directly this session, not from memory)

- `https://github.com/a2ui-project/a2ui`, `main` branch — the real spec repo.
- `specification/v1_0/docs/a2ui_protocol.md` — prose spec.
- `specification/v1_0/json/{common_types,agent_to_renderer,renderer_to_agent,catalog_definition,renderer_data_model,agent_to_renderer_list,sample}.json` — the real JSON Schemas, fetched via raw.githubusercontent.com and read in full; every field name, `required` array, and `additionalProperties`/`unevaluatedProperties: false` closure in this package's Zod schemas was copied from these, not guessed.
- `specification/v1_0/catalogs/basic/catalog.json` (53KB — 18 components, 14 functions) — the reference "basic" catalog.
- `specification/v1_0/test/cases/*.json` and `contact_form_example.jsonl` — the spec repo's **own conformance test suite** (found and used after a coordinator nudge to search harder for existing tooling before hand-building more — see "Cross-validation against the official conformance suite" below; this caught a real bug).

## `@a2ui/web_core` / `@a2ui/react` — checked, not usable as a foundation

Per the task brief's explicit instruction, the official npm SDK was checked *before* hand-writing
anything. Verified directly against the npm registry and unpkg this session:

- `@a2ui/web_core@0.10.5`'s `package.json` `exports` map only publishes `.` (→ `v0_8`, the default)
  and `./v0_9`. **There is no `v1_0` export path in the published package**, confirmed by fetching
  `v0_9/index.d.ts` directly (its `Schemas.A2uiMessageSchemaRaw` only lists `CreateSurfaceMessage`/
  `UpdateComponentsMessage`/`UpdateDataModelMessage`/`DeleteSurfaceMessage` — no `CallFunctionMessage`/
  `ActionResponseMessage`, and no renderer→agent `action`/`functionResponse`/`error` schema visible
  in that export list either).
- `@a2ui/react@0.10.1` (checked via web search, same publish cadence) is the same story: v0.8
  default, v0.9 available, no v1.0.
- **This is why every wire type in this package is hand-rolled directly from the v1.0 JSON
  Schemas**, not derived from the SDK — the SDK's own bidirectional-RPC/`callableFrom` boundary
  (the part of v1.0 the task brief called out as the actual security-relevant new surface) doesn't
  exist in any published version of it yet.
- The real `renderers/react` example (browsed, not imported — see the coordinator-nudge section
  below) confirmed the general shape this package already used independently is consistent with
  the reference implementation's own architecture: a per-type React component registry + a
  "resolve `Dynamic*` props before rendering" step (their "Generic Binder"; this package's
  `resolve.ts` + `RenderComponent`'s `resolveText`).

## What's implemented

| File | Contents |
|---|---|
| `src/common-types.ts` | `ComponentId`, `CallId`, `DataBinding`, `DynamicValue`/`DynamicString`/`DynamicNumber`/`DynamicBoolean`/`DynamicStringList`, `FunctionCall` (recursive, `z.lazy`), `IndexSystemFunction` (`@index`), `AccessibilityAttributes`, `ComponentCommon`, `Child`/`ChildList` (static array + template forms), `CheckRule`/`Checkable`, `Action` (agent-event / local-functionCall union) — every `common_types.json` `$def`. |
| `src/agent-to-renderer.ts` | All 6 agent→renderer envelopes (`createSurface`/`updateComponents`/`updateDataModel`/`deleteSurface`/`callFunction`/`actionResponse`) + `parseAgentToRendererMessage`, a hand-written dispatcher (not a plain `z.union`) that inspects which message-type key is present *before* validating, so a malformed envelope gets a specific reason (missing version / no known key / two keys at once / a named field failure), not a generic union-error dump. |
| `src/renderer-to-agent.ts` | All 3 renderer→agent envelopes (`action`/`functionResponse`/`error`, including the `VALIDATION_FAILED` vs. generic-error split and the `surfaceId` XOR `functionCallId` constraint) + builders + the same kind of dispatcher-style parser. |
| `src/catalog.ts` | `Catalog`/`ComponentSpec`/`FunctionSpec` types, `isComponentAllowed`/`callableFromOf`/`isFunctionRegistered`, and `createLabCatalog()` — see "Catalog scope" below. |
| `src/json-pointer.ts` | RFC 6901 get/set, including A2UI's own documented deviation (`"/"` means "whole document," not literal RFC 6901). |
| `src/resolve.ts` | Resolves `Dynamic*` values against a data model + item scope; never throws; the `callableFrom` boundary check lives here. |
| `src/tree.ts` | `flattenRenderTree` — cycle/missing-child-safe depth-first walk (static `ChildList` only). |
| `src/interpreter.ts` | `createA2uiInterpreter(catalog)` — the stateful per-surface component-map + data-model interpreter; see its own module doc for 4 explicit, documented design decisions made where the spec text is silent. |

## Catalog scope — 18 of 18 components, 3 (+3 lab-only) of 14 functions

`createLabCatalog()` implements **all 18** of the real basic catalog's components — `Text`,
`Image`, `Icon`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`,
`Divider`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput` — each
ported field-for-field from `specification/v1_0/catalogs/basic/catalog.json`'s own property
definitions: property names, types, `required` arrays, enum members, default values, and the
`allOf` mixin composition, all copied from the fetched JSON rather than inferred from the
component's name. (The initial pass implemented only the first four; the other 14 landed
2026-07-28.)

"Implemented" here means the **protocol/validation layer**: the type is whitelisted,
closed-schema-validated (`.strict()`, Zod's equivalent of the real schema's
`unevaluatedProperties: false`), defaulted, and held in interpreter state. Whether a given host
renderer *draws* it is a separate concern this package has no opinion on — `examples/reference-web`'s
`A2uiLab.tsx` still only has React cases for the original four.

Structural details worth recording, each verified against the fetched catalog rather than assumed:

- **`Checkable` is mixed in by exactly 6 of the 18** (`Button`, `TextField`, `CheckBox`,
  `ChoicePicker`, `Slider`, `DateTimeInput`) — read off each component's own `allOf` list, not
  guessed from which ones look form-shaped. The other 12 reject a `checks` property outright.
- **`weight` is not part of `ComponentCommon`** — all 18 re-declare it individually with an
  identical type and description. Hoisted into one shared shape only after confirming all 18 match.
- **`Icon.name` is not a `DynamicString`.** Its `oneOf` admits an enum member (59 of them,
  generated from the catalog JSON rather than transcribed), a `{svgPath}` object, or a bare
  `DataBinding` — but **not** a `FunctionCall`, unlike essentially every other dynamic-valued
  property in the catalog.
- **`Slider.max` is required while `Slider.min` defaults to 0**, and `min`/`max` are plain numbers
  while only `value` is dynamic — an asymmetry that reads like a transcription slip but is exactly
  what the real schema says.
- **`ChoicePicker`'s per-option `value` is a plain `string`**, not a `DynamicString` ("the stable
  value associated with this option"), and `options` has no `minItems`, so an empty list is legal.
- **`List` uses `direction`**, not Row/Column's `justify`.

### A real bug this pass found and fixed: `accessibility` was refused on every component

`common_types.json#/$defs/ComponentCommon` carries `id` **and `accessibility`**, and all 18
components `allOf` it — so `accessibility` is legal on every one of them. But the interpreter
strips only `id`/`component` before per-type validation, and every props schema is `.strict()`,
so a spec-valid component carrying `accessibility` was rejected outright with
`VALIDATION_FAILED: Unrecognized key(s) in object: 'accessibility'`. `AccessibilityAttributes`
existed as a real, tested wire type in `common-types.ts`, but *nothing accepted it on a component* —
the gap was invisible because no existing test sent one. Fixed by composing `ComponentCommon` into
every props schema the way the real catalog does; pinned by a table-driven test over all 18 types
so it cannot regress for a single component.

### Documented judgment call: `DateTimeInput.min`/`max` format assertion

The one genuinely ambiguous spot in the 18. The real definition is
`allOf: [DynamicString, {if: {type: string}, then: {oneOf: [{format: date}, {format: time}, {format: date-time}]}}]`.
JSON Schema's `format` is an *annotation* by default (ajv — which the spec's own conformance runner
uses — only asserts it with `ajv-formats`), which would make the constraint advisory; but the author
wrapped it in an `if`/`then`/`oneOf`, a construct that is only meaningful as an assertion.

Decision: **assert it, but against ISO 8601 rather than RFC 3339.** The property's own description
says "in ISO 8601 format", whereas JSON Schema's `format: time`/`date-time` formally mean RFC 3339 —
which *requires* a UTC offset, so a literal `"09:00"` would be refused despite being good ISO 8601
and an obvious thing for an agent to send. Rejecting that seemed clearly worse than accepting a
value RFC 3339 purists would call under-specified. `DataBinding`/`FunctionCall` forms pass through
unchecked (their value isn't known until resolution time). No official fixture pins this behavior
either way, so it is flagged here and in a code comment on `IsoDateTimeBoundSchema` rather than
presented as a literal port.

Functions: `and`/`or`/`not` ported faithfully (see the bug-and-fix story below). **Not
implemented**: `required`, `regex`, `length`, `numeric`, `email`, `formatString`, `formatNumber`,
`formatCurrency`, `formatDate`, `pluralize`, `openUrl` — their semantics depend on
locale/formatting/regex details not fully pinned down by the schema text alone, and were
deliberately not guessed at. Three **lab-only** demo functions (`greetUser`/`logServerEvent`/
`adminReset`, clearly not part of the real basic catalog) exist purely to exercise all three
`callableFrom` values — the real basic catalog's own 14 functions are *all* `rendererOnly`, which
alone can't test the `agentOnly`/`rendererOrAgent` boundary the spec calls out as security-relevant.

**Also not implemented**: per-property JSON-Schema validation of catalog-defined function
arguments (e.g. a real catalog could constrain `required`'s `value` arg more narrowly than the
generic `FunctionCall.args` shape allows) — confirmed as a real, named gap by the official
`call_function_message.json` conformance cases (see below), not an oversight discovered after the
fact. Template/dynamic-list `ChildList` (`{componentId, path}`, generating N children from a
data-model array) is parsed on the wire but not expanded by the interpreter or the React renderer —
a deliberate scope cut (item-scoped relative-path resolution, `@index`, per-item React keys for one
shared component definition rendered N times is a substantially larger feature).

## Cross-validation against the official conformance suite (coordinator-nudged, caught a real bug)

Mid-task, the coordinator flagged a general pattern risk (a sibling agent almost rebuilding a
WebMCP polyfill that already existed on npm) and asked: before hand-building more, search harder
for existing A2UI tooling — reference renderers, conformance suites, sample fixtures. That search
found `specification/v1_0/test/` (a Python/ajv-based conformance runner over `test/cases/*.json`)
and `specification/v1_0/test/cases/contact_form_example.jsonl` (a complete, real, spec-authored
message sequence). `src/__tests__/spec-fixtures.test.ts` runs a substantial subset of these
official fixtures — verbatim, with attribution — through this package's own parsers/interpreter:

- **`renderer_messages.json`** (renderer→agent, fully generic): 100% agreement with this port's
  `parseRendererToAgentMessage` on every case.
- **`call_function_message.json`** (agent→renderer `callFunction`): the 5 catalog-independent
  cases agree 1:1; 3 catalog-*dependent* cases (invalid only because of `testing_catalog.json`'s
  own function-arg schemas or `callableFrom`, neither of which this port's generic wire layer
  implements) are asserted with their **actual, diverging** result and an explicit comment on why
  — not silently skipped. One of those (`"required"`, a `callableFrom: rendererOnly` function
  called via `callFunction`) is also proven refused **end to end through the full interpreter**
  (not registered in this port's catalog → `INVALID_FUNCTION_CALL`), matching the official
  expectation's outcome even though this port's reason (unregistered) differs from the official
  catalog's reason (registered-but-rendererOnly).
- **`text_variants.json`**: `Text`'s real `variant` enum (`caption`/`body` only — **not** `h1`,
  contrary to what an LLM familiar with HTML might guess) verified against the real fixture's own
  valid/invalid cases, run through the interpreter (catalog-level, not wire-level, since `variant`
  is catalog-owned).
- **`contact_form_example.jsonl`**: every line parses at the wire level; the full 4-message sequence
  is run through the interpreter. This case *strengthened* when the remaining 14 components landed —
  it used to prove that unimplemented types (`Card`/`Icon`/`TextField`/`ChoicePicker`/`Divider`/
  `CheckBox`) were refused **individually** rather than choking the whole message; now the same
  unmodified fixture is accepted **end to end with zero validation errors**, all 25 components
  including a `Card` root. That is the strongest single check on the 18 schemas: the fixture was
  authored by the spec's maintainers, independently of this port, so every required/optional/enum/
  default decision has to be right for it to pass clean.
- **`icon_checks.json`** (6 cases) and **`tabs_checks.json`** (2 cases): 100% agreement with the
  official `valid` flag, including `Icon`'s three-way `oneOf` (enum / `{svgPath}` / `DataBinding`),
  the `svgPath: 12345` type mismatch, the extra-key-in-binding case, and `Tabs`' `minItems: 1`.
- **`checkable_components.json`** (15 cases): 100% agreement — the single best independent check on
  the 6 `Checkable` components, since the spec's own maintainers wrote it to pin down `checks`
  behavior across `TextField`/`ChoicePicker`/`Slider`/`CheckBox`/`DateTimeInput` (including nested
  `and`/`or`/`not` compositions and `Slider.steps`' integer-≥-1 constraint). One case agrees for a
  narrower reason, recorded in the test: the official catalog rejects
  `{call: 'formatString', …, returnType: 'string'}` because `formatString`'s declared `returnType`
  isn't the boolean a `CheckRule` needs (per-function returnType checking this port doesn't
  implement), while this port rejects it one layer earlier — `returnType` isn't a property
  `FunctionCall` permits at all, so `.strict()` refuses the unknown key regardless of catalog.

**A real bug this caught**: this port's first draft of `and`/`or` read an arbitrary flat map of
`args` keys (`{a: true, b: false}`), each independently required `=== true`. The real basic
catalog's own function definitions (`and`/`or`'s `args.values`, a `minItems: 2` **array** of
`DynamicBoolean`) — and independently, `button_checks.json`'s real fixture, which composes
`and(values: [required(...), or(values: [...])])` — showed this was wrong: the real shape is a
single `values` array, not a flat multi-key map. Fixed in `catalog.ts` (`and`/`or` now read
`args.values`), and `resolve.ts`'s arg-resolution loop was extended to recurse into array-typed
args element-by-element (previously, a nested `DataBinding`/`FunctionCall` *inside* an array arg
would have passed through unresolved as a raw object, silently breaking `and`/`or`'s boolean
comparison rather than failing loudly). This would **not** have been caught by re-reading
`common_types.json` alone — that file only defines the generic `FunctionCall` envelope, not any
one function's own `args` shape; catching it required the basic catalog's per-function schema
*and* the conformance fixture's real usage example, both fetched only after the coordinator's nudge
to search harder before trusting this port's own first-pass reading.

## Adversarial cases — every one from the task brief, both unit-level and live-in-browser

All eight required cases were tested **both** ways: deterministically at the unit level (part of
the test suite below, 100% coverage) **and** live, driving the actual running interpreter instance
in a real browser via Playwright `browser_evaluate` against `window.__a2uiLab` (test-only global —
see `A2uiLab.tsx`). Live results (verified this session, `examples/reference-web` on
`http://127.0.0.1:7317`/`7173`, later reverted to the real 4317/4173 — see "Live verification" in
the final task report):

| Case | Unit-tested | Live-verified | Result |
|---|---|---|---|
| Child ID referencing a component that doesn't exist | ✅ (`tree.test.ts`, `interpreter.test.ts`) | ✅ (`browser_evaluate` + snapshot) | Renders a visible "⚠ missing component" placeholder, no crash, no console error. |
| Circular reference (A → B → A) | ✅ | ✅ | Renders "⟲ circular reference", terminates instead of infinite-looping/stack-overflowing. |
| `Dynamic*` binding whose path doesn't resolve | ✅ (`resolve.test.ts`) | ✅ | Renders "⚠ unresolved (PATH_NOT_FOUND)"; `resolveDynamicValue` never throws by construction. |
| Component type not in the active catalog | ✅ | ✅ | Refused with a `VALIDATION_FAILED` error citing the exact path; never added to the component map (confirmed both via `getSurface(...).components.has(...) === false` and DOM: the type never renders). |
| `callFunction` marked `callableFrom: rendererOnly` invoked by the agent | ✅ | ✅ | Refused with `code: 'INVALID_FUNCTION_CALL'` (the literal code the spec's prose doc names) — the exact security-boundary case the task called out. |
| Rapid-fire `updateComponents`/`updateDataModel` | ✅ (50-message sequences) | ✅ (50 synchronous `applyAgentMessage` calls in one `browser_evaluate`) | Fully consistent final state — this interpreter has no async gaps in message processing, so "rapid-fire" cannot interleave by construction. |
| `deleteSurface` while an action is mid-flight | ✅ | ✅ | `buildAction` registers a pending action id → `deleteSurface` drops the whole `SurfaceState` (including its pending-action table) → a late `actionResponse` for that id is a silent, non-throwing no-op. Live: UI cleanly reverted to "waiting for root" after the delete, no crash. |
| Malformed envelope (missing `version`, wrong message-type key, extra unknown fields) | ✅ | ✅ | All three rejected — the first two via the out-of-band `unattributedViolation` channel (no `surfaceId` can be attributed to a message this broken), the third via a spec-shaped `VALIDATION_FAILED` error (Zod's `.strict()` catches the unrecognized key). |

Two **regression bugs found and fixed** while writing the malformed-envelope tests (not part of the
required list, found by being thorough about it): (1) the original `bestEffortSurfaceId` fallback
called `Object.keys(raw)` without checking `raw` was actually an object first — `Object.keys(null)`
throws, so `interpreter.applyAgentMessage(null)` would have crashed instead of degrading; (2) that
same fallback picked "the first non-version object key" to look for a `surfaceId` on, which could
misattribute an error to the wrong field if an envelope carried unrelated extra top-level junk
ahead of its real message-type key in insertion order. Both fixed, both covered by dedicated
regression tests (`interpreter.test.ts`, "malformed envelopes never mutate state" describe block).

## Tests

336 tests across 10 files, **100% statement/branch/function/line coverage** on every file with
executable statements (`pnpm --filter @jini-ai/a2ui run test:coverage`; the configured threshold is
98 on all four metrics).
Reached honestly per this repo's `honest-testing` skill — no `ignore` comments, no lowered
thresholds, no softened assertions; every genuinely-unreachable branch removed (not
fake-tested) with a comment naming the invariant that guarantees it:

- Zod's own guarantee that `safeParse`'s `success: false` implies a non-empty `error.issues` array
  (3 call sites: `agent-to-renderer.ts`, `renderer-to-agent.ts`, `interpreter.ts`'s
  `applyComponentsList`).
- `ActionSchema`'s closed 2-branch union (`{event}` | `{functionCall}`), validated at component
  ingestion — after eliminating the `functionCall` branch, TypeScript's own control-flow narrowing
  proves the remainder is the `event` branch; the redundant runtime `isAgentEventAction` re-check
  in `buildAction` was removed rather than defensively kept-and-untested (the type guard itself
  still gets its own direct unit test in `common-types.test.ts`, since it's real exported public
  API a host renderer might use independently).
- `ParseFailure.path` is only ever unset for the "raw input wasn't an object" case, which cannot
  coexist with a truthy extracted `surfaceId` (that extraction itself requires an object) —
  asserted with `!` and a comment, not defensively branched.

Test count before this task: 0 (package did not exist). After: 165, all passing, all real
(verified running — see the terminal output pasted into the final task report, not just claimed).

### Full-catalog pass, 2026-07-28 (the remaining 14 components)

**167 → 336 tests** (`catalog.test.ts` 5 → 150, `spec-fixtures.test.ts` 22 → 45), coverage still
100/100/100/100. No existing test was deleted or weakened. Two existing assertions *inverted*,
both because they encoded the old gap rather than a real invariant, and both became stronger:

- `catalog.test.ts`'s "these real basic-catalog types are not allowed" list (`Image`, `Icon`,
  `Video`, `Modal`, `TextField`, `CheckBox`, `DateTimeInput`) — now they *are* allowed, so the
  adversarial test asserts refusal of genuinely-not-in-the-catalog names instead, including the
  real casing traps `Checkbox`/`Textfield` (the spec spells them `CheckBox`/`TextField`).
- `spec-fixtures.test.ts`'s contact-form assertion, described above.

### Reconciliation pass, 2026-07-28 (rebase onto `feat/agentic-capability-layer`)

Rebased 100 commits forward and reviewed. **One real correctness bug found and fixed in review**
(`resolve.ts`'s `resolveBindingPath`): a *relative* collection-scope binding path is still RFC 6901
syntax, but it was split on `/` and each raw piece handed to `joinPointer`, which escapes tokens —
so an already-escaped token got escaped a second time. A relative `a~1b` therefore resolved the key
literally named `a~1b`, while the equivalent absolute pointer `/items/0/a~1b` correctly resolved the
key `a/b`. The two spellings disagreed. Fixed by decoding with `parsePointerTokens` before
re-escaping; two regression tests pin both `~1` and `~0` against the absolute-pointer result
(165 → 167 tests, coverage still 100/100/100/100). Reachable today only through the public
`interpreter.resolve(surfaceId, value, itemBasePath, itemIndex)` API, since template `ChildList`
expansion — the other producer of an `itemScope` — is not implemented (see the gap list below).

## Dependencies

`zod` (`^3.25.76`, the same version already pinned by `@jini-ai/protocol`/`@jini-ai/metatool` — no new
version introduced to the workspace).

## `@jini-ai/protocol` change this task made

Added one new `RunAgentPayload` variant (`packages/protocol/src/events.ts`): `{ type: 'a2ui';
message: unknown }`, carrying one A2UI agent→renderer envelope verbatim through the existing
`RunLifecycle.emit('agent', ...)` channel — the same mechanism the `stage_start`/`surface_request`
variants already use. `message: unknown` (not
`AgentToRendererMessage`) deliberately: `@jini-ai/protocol` sits below every other package and must
not depend sideways on `@jini-ai/a2ui` for one variant's shape; the real structural validation happens
on the consuming side (`@jini-ai/a2ui`'s own `parseAgentToRendererMessage`). Verified zero regression
risk before adding it: grepped every `@jini-ai/*` package for an exhaustive `switch`/assertNever over
`RunAgentPayload.type` (none found — `packages/agentic/src/gen-ui/encoder.ts`'s switch and
`packages/daemon/src/agent-executor.ts`'s equality checks both have `default`/fallthrough
behavior, unaffected by a new union member). Re-verified 2026-07-28 against the current tree
after this branch was rebased 100 commits forward: the encoder's `default: return null` is still
there, and the only `assertNever` in `packages/*` (`packages/mcp/src/agent-install/install.ts:344`)
is over an unrelated union. `packages/protocol`'s own test suite re-run clean after the change.

## Fixture: `examples/reference-web` `#/a2ui-lab`

- `examples/reference-web/src/daemon.ts`: `runA2uiDemo` streams a real
  `createSurface` → `updateComponents` → (click-driven) `updateDataModel` sequence through the same
  `RunLifecycle`/`createLocalNodeDaemon` every other playground demo uses (`onRunStarted` dispatches
  on `agentId === 'a2ui-demo'`, checked before the playground-specific `decodeRunRequest`). Every
  outgoing message is validated through `parseAgentToRendererMessage` before being emitted
  (`emitA2ui`), so a typo in the demo's own literals fails loudly server-side instead of reaching
  the renderer as something it then has to reject.
- **The renderer → agent action round trip is real, not simulated**: clicking the button calls
  `interpreter.buildAction(...)`, which resolves the component's `action` prop and (for an
  agent-event action) builds a spec-shaped `action` envelope; the browser POSTs
  `{runId, message}` to `/a2ui-action`, a **dedicated `node:http` server** (`startA2uiActionRelay`,
  its own port, not a route bolted onto the daemon's already-listening Express app — see that
  function's own doc for why two 'request' listeners on one Node `http.Server` is fragile), which
  validates the envelope via `parseRendererToAgentMessage` and delivers it into `runA2uiDemo`'s
  `waitForA2uiAction` queue. The demo then emits real `updateDataModel` messages back through the
  same SSE stream. Verified live via Playwright's network trace: `POST /a2ui-action → 202`,
  followed by the daemon's real response landing back in the browser's message log and DOM.
- **Not routed through `@jini-ai/chat-react`'s conversation abstraction** — a deliberate choice, not
  an oversight: that abstraction is chat-*message*-shaped (`ChatMessage`/`useConversation`), and
  A2UI's surface state has no natural chat-message projection. The fixture *does* go through the
  same real `@jini-ai/daemon` `RunLifecycle` + `@jini-ai/node-host` HTTP daemon + real SSE stream
  `AgentLab`/chat-pane itself would use (`POST /api/runs`, `GET /api/runs/:id/events`) — "reachable
  through the real chat-pane execution path" is satisfied at the daemon/transport layer, not by
  reusing the chat-message UI layer, which would have been a worse fit for surface-shaped state.
- `window.__a2uiLab` (interpreter + catalog + runId/surfaceId) is exposed for adversarial
  `browser_evaluate` testing — explicitly test-only, documented as such in `A2uiLab.tsx`'s module
  doc, not part of the real product surface.

## Honest overall gap against full v1.0 spec parity

This is a real but partial port. Not implemented: 11 of 14
basic-catalog functions (all format/validation-shaped, deliberately not guessed at); template/
dynamic-list `ChildList` expansion (parsed, not rendered); per-catalog-function JSON-Schema
argument validation (only name whitelist + `callableFrom` boundary enforcement); `sendDataModel`
(accepted on the wire, `SurfaceState` stores the flag, but nothing yet reads it to actually attach
`renderer_data_model.json`-shaped metadata to outgoing renderer→agent messages); accessibility
attributes (`AccessibilityAttributes` is a real, tested wire type, but the React renderer doesn't
yet thread `aria-label`/`aria-description` through to the DOM). What *is* implemented — the six +
three envelope shapes, JSON-Pointer data binding (including the documented `"/"` deviation), the
catalog security boundary (component whitelist + bidirectional `callableFrom` enforcement, the
spec's own named security-relevant surface), and a real, live, adversarially-tested end-to-end
round trip — was cross-validated against the spec's own official conformance fixtures, not just
this port's own understanding of the schema text.

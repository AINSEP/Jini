# `@jini/agentic` — provenance

Extracted 2026-07-26 out of `@jini/chat-core` (`src/agentic/*`, minus `chat-capabilities.ts`) and
`@jini/chat-react` (`src/agent-bridge/dom-page-driver.ts`), per
`ADS-memory/reports/proposals/PLAN-jini-agentic-extraction-2026-07-26.md` — a decided execution
plan, not a proposal. Every file below is a `git mv`, not new work; see each source package's own
`source-map.md` (chat-core's "Agent-control vocabulary" section, dated 2026-07-25) for the original
OD-provenance accounting. Nothing here has an OD origin — this vocabulary was new work when it
first landed in chat-core, and remains new work; only its package location changed.

**Why extracted:** the agent-facing surface — the capability vocabulary, the `data-agent-*`
markup convention, the policy gate, and the two shipped manifests — had nothing to do with chat,
but lived inside `@jini/chat-core`. A consumer that wants a non-chat surface to be agent-drivable
(a future `@jini/ui` `agentHandle()`, `@jini/daemon`'s structural `FrontendCapabilitySpec`) had to
depend on the chat package to reach it. `examples/minimal-host` exists to catch exactly that kind
of unwarranted coupling.

## File map

| Jini file | Moved from | Transform |
|---|---|---|
| `src/agui/events.ts` | `@jini/agui`'s `src/types.ts` | `git mv` + renamed, into a new `src/agui/` subdirectory. See "Folded from `@jini/agui`" below. |
| `src/agui/encoder.ts` | `@jini/agui`'s `src/encode.ts` | `git mv` + renamed, into a new `src/agui/` subdirectory. See "Folded from `@jini/agui`" below. |
| `src/capability.ts` | `chat-core/src/agentic/capability.ts` | Verbatim `git mv`. |
| `src/guards.ts` | `chat-core/src/agentic/guards.ts` | Verbatim `git mv`. |
| `src/element-handles.ts` | `chat-core/src/agentic/element-handles.ts` | Verbatim `git mv`. |
| `src/page-driver.ts` | `chat-core/src/agentic/page-driver.ts` | Verbatim `git mv`. |
| `src/page-executor.ts` | `chat-core/src/agentic/page-executor.ts` | Verbatim `git mv`. |
| `src/page-capabilities.ts` | `chat-core/src/agentic/page-capabilities.ts` | Verbatim `git mv`. |
| `src/ag-ui.ts` | `chat-core/src/agentic/ag-ui.ts` | Verbatim `git mv`. |
| `src/mcp-ui.ts` | `chat-core/src/agentic/mcp-ui.ts` | Verbatim `git mv`. |
| `src/webmcp.ts` | `chat-core/src/agentic/webmcp.ts` | Verbatim `git mv`. |
| `src/index.ts` | *(new — barrel)* | Re-exports every module above. `chat-core/src/agentic/index.ts` is NOT this file — it stayed behind, rewritten to export only `CHAT_CAPABILITIES` and re-export this package's public types it still needs. |
| `src/dom/dom-page-driver.ts` | `chat-react/src/agent-bridge/dom-page-driver.ts` | Verbatim `git mv`. Its imports of the universal vocabulary (`AGENT_ELEMENT_ATTRIBUTE`, `normalizeAgentLabel`, `resolveHandleSelector`, etc.) changed from a cross-package `@jini/chat-core` import to relative sibling imports (`../guards.js`, `../element-handles.js`) now that both live in the same package. |
| `src/dom/index.ts` | *(new — barrel)* | Re-exports `dom-page-driver.ts`. Published as the `./dom` subpath export — see "The DOM split" below. |

`chat-core/src/agentic/chat-capabilities.ts` **did not move** — see plan §3. It is a genuine chat
product surface (`chat.send_message`, `chat.set_draft`, `chat.select_agent`, …), not vocabulary,
and chat-core keeps it, now importing `CapabilityDef` from this package instead of a sibling file.

## The DOM split (why this package has two entry points)

Everything under `src/` except `src/dom/` compiles under `tsconfig.json`, which extends the repo's
`tsconfig.base.json` unmodified (`lib: ["ES2023"]`, no `DOM`) and **excludes `src/dom` entirely**.
`src/dom/` compiles separately under `tsconfig.dom.json`, the only config in this package with
`DOM`/`DOM.Iterable` in `lib`.

This is a compile-time guarantee, not a convention: a `document`/`window` reference anywhere
outside `src/dom/**` fails `tsc -p tsconfig.json` with "Cannot find name 'document'" (verified
during the 2026-07-26 extraction — see the extraction's report for the exact command and error
text). That is what proves the policy layer (`page-executor.ts`'s guards, refusals, and
allowlist-enforcement) cannot quietly reach into a live page; only `src/dom/dom-page-driver.ts`,
the one `PageDriver` implementation that legitimately needs a DOM, may.

Two `package.json` exports follow the same split:

- `.` (`dist/index.d.ts`/`dist/index.js`, built by `tsconfig.json`) — the DOM-free vocabulary,
  policy gate, and protocol projections. What `@jini/chat-core`, `@jini/daemon` (structurally, see
  below), and (once §5 of the plan lands) `@jini/ui` depend on.
- `./dom` (`dist/dom/index.d.ts`/`dist/dom/index.js`, built by `tsconfig.dom.json`) — the browser
  `PageDriver`. What `@jini/chat-react` depends on.

`scripts/check-engine-boundaries.ts` R2 normally allows only bare `@jini/<name>` imports (one
entry point per package), with a single named exception for `@jini/core/internal`. This extraction
added a second, identically-gated exception for the exact literal `@jini/agentic/dom` — not a
pattern — because `@jini/chat-react` genuinely needs the DOM half and there is no third package for
it to live in without recreating the sprawl this plan exists to reduce (23 packages vs. a locked
14). See that script's own module doc for the up-to-date rule list.

## Folded from `@jini/agui` (2026-07-26, plan §3a/§4a)

The standalone `@jini/agui` package — three files, `types.ts`/`encode.ts`/`index.ts`, zero I/O —
folded into this package and the package itself was deleted. The original plan (§3) kept it out on
the grounds that it was "a transport, and a transport is not a vocabulary." §3a corrected that: the
code has no node builtins, no fetch, no http, no streams; `createAguiEncoder()` is a pure
`RunProtocolEvent → AguiEvent` transform, `runtime: universal`, depending only on `@jini/protocol`
(a dependency-free leaf, so this adds no cycle). The actual SSE transport lives in `@jini/http`
(`run-stream.ts`) and the actual connection is opened by a composition root
(`examples/reference-web/src/daemon.ts`) — neither of those facts describes where the encoder
*belongs*, only where it is *called*, which is the distinction the original plan missed.

Placed in a new `src/agui/` subdirectory rather than as flat `src/agui-events.ts`/`agui-encoder.ts`
files (mid-task course correction, once the flat names existed and made the collision-avoidance
concern below visible as sprawl) — `src/dom/` already established the precedent that a
package can hold a real subdirectory, not just one file per concern. This also sidesteps any
naming collision with this package's own pre-existing `ag-ui.ts`: both are "AG-UI", but they are
unrelated halves of the same external protocol.

| File | What it does |
|---|---|
| `ag-ui.ts` (pre-existing, package root) | Projects a {@link CapabilityDef} into an AG-UI **frontend tool** declaration (`RunAgentInput.tools`) — the vocabulary translation for capabilities a frontend exposes to an agent. |
| `agui/events.ts` / `agui/encoder.ts` (folded in) | Encodes a run's `RunProtocolEvent` **wire event stream** into AG-UI's SSE event shapes (`agent.message`, `tool_call`, `run.lifecycle`, …) — the opposite direction: an agent's run, projected outward for a UI to render. |

Test files moved alongside: `src/__tests__/encode.test.ts` → `src/agui/__tests__/encoder.test.ts`
(26 tests, unit tests of the encoder itself — only its `../encode.js` import path changed, to
`../encoder.js`), and `src/__tests__/index.test.ts` → `src/__tests__/agui-barrel.test.ts` (2 tests
— exercises `createAguiEncoder`'s presence and one end-to-end encode through this package's own
top-level public barrel, so it stayed at `src/__tests__/` rather than moving into `src/agui/`,
since its subject is the *package's* barrel, not the `agui/` module in isolation; needed no
import-path change since it already imported its subject via `../index.js`, which is this
package's barrel now instead of `@jini/agui`'s). agui's own `src/index.ts` (a two-line re-export
barrel, no logic) did not survive as a discrete file — its exports were folded directly into this
package's existing `src/index.ts` rather than kept as a separate near-empty file; nothing it did
is lost, see this package's `index.ts` for the `agui/encoder.js`/`agui/events.js` export block.
`examples/reference-web`'s `daemon.ts` (`createAguiEncoder` import) and `package.json` re-pointed
from `@jini/agui` to `@jini/agentic`; `@jini/agui`'s own detailed provenance (the origin adapter it
was ported from, the old→new field-mapping table, the six-event-kind generalization writeup that
added `stage_start`/`stage_end`/`surface_request`/`surface_response` to `@jini/protocol`) is
preserved verbatim in git history at `packages/agui/source-map.md` as of commit `7773af01e` and
earlier — not re-derived or duplicated here.

**Admission consequence:** `@jini/agui` was `jini.admission: "incubating"` (see `UNLOCKED.md`,
added 2026-07-19, never promoted). Folding incubating code into an `admitted` package promotes it
— there is no intermediate state for code that no longer has its own package boundary. This is not
a bypass of the normal incubating→stable gate (named consumer, API snapshot, minimal-host slice
test, sign-off): those four requirements were about `@jini/agui` continuing to exist as a
standalone, separately-consumed unit, a question this move makes moot by removing that unit
entirely. `UNLOCKED.md`'s `@jini/agui` entry is removed (not merely marked promoted) with a note
that it was folded in, not dropped — the distinction the plan is careful to draw, since a folded-in
admission and a promoted-in-place admission answer different questions ("does this code still need
its own gate" vs. "did this code clear the gate").

## Per-entry runtime metadata (`jini.entries`, 2026-07-26, plan §8 step 8)

`package.json`'s `jini.runtime` is a single value (`universal | node | browser | desktop`), and
this package's root is universal but `./dom` is browser-only — no single value is honest. The gap
was recorded here (rather than worked around) when the package was created; it is now closed by an
optional `jini.entries` map, validated by `scripts/check-engine-boundaries.ts`'s R8 extension:

```json
"jini": {
  "runtime": "universal",
  "entries": { ".": "universal", "./dom": "browser" }
}
```

`entries["."]` agrees with the top-level `runtime` (kept for tooling that only reads the
single-value field); `entries["./dom"]` records the browser-only half honestly. `pnpm guard`
checks both directions — every `entries` key must name a real `exports` subpath and every
`exports` subpath must have a matching `entries` key — so a stale or typo'd mapping is caught
rather than silently drifting. See `packages/README.md`'s "`entries` — when one `runtime` can't
describe every export subpath" for the general shape; every other package leaves `entries` unset
and needed no edits for this to land.

## Admission

`jini.admission: "admitted"`, `UNLOCKED.md` status `"stable"`, recorded at package creation rather
than going through the normal incubating → stable promotion gate. Reasoning: this is a relocation
of code that was already inside a `locked` package (`chat-core`) and already had 615+393 tests
passing against it; downgrading it to `incubating` on the day it moved would have blocked the very
imports (`chat-core`, `chat-react` are both `locked`) the extraction exists to serve — `incubating`
packages cannot be imported by `locked` ones. See `UNLOCKED.md`'s entry for the exact note.

## Dependencies

`@jini/protocol` (workspace, type-only) — added by the `@jini/agui` fold above, for
`RunAgentPayload`/`RunProtocolEvent`. `@jini/protocol` is a dependency-free leaf (per
`extraction-plan.md`'s locked layering), so this is a new downward edge, not a cycle. Everything
else in this package needs nothing beyond the TypeScript standard library — same as
`chat-core/agentic` before it. `src/dom/` depends on the DOM lib (a `lib`, not a package
dependency) and on this package's own sibling modules; nothing else.

## Not ported / explicitly deferred (inherited from before the move, not new)

- `page-driver.ts` and `page-capabilities.ts` have no dedicated test file — pre-existing before
  this extraction; `capability.test.ts`'s own comment already noted this (their behavior is
  exercised indirectly through `page-executor.test.ts` and `capability.test.ts`'s manifest-shape
  checks). Not introduced or fixed by this move.

## `handle.ts` — `agentHandle()` (2026-07-26, plan §8 step 5)

New file, not a move: the attribute-props helper a component spreads onto its root element to
publish itself under this package's `data-agent-*` convention — `agentHandle('save')` →
`{ 'data-agent-element': 'save' }`, with optional `role`/`label`/`page`. Pure data (an object of
string attributes), no DOM — belongs in the universal root, not `./dom`.

Deliberately reuses `element-handles.ts`'s own `isValidElementHandle` rather than writing a second
validity check: an adversarial probe (`element-handles.test.ts`, "refuses anything that could
escape the attribute selector" — quotes, brackets, backslashes, whitespace, uppercase, leading/
trailing/double hyphens, unicode, overlong handles) already proved that function sound, so a
second rule here would only risk drifting from it, not add safety.

`@jini/ui` now depends on this package for `agentHandle()` — the first non-chat, non-daemon
consumer this extraction's own rationale (§1: "the agent-facing surface... had nothing to do with
chat, but lived inside `@jini/chat-core`... a future `@jini/ui` `agentHandle()`... had to depend on
the chat package to reach it") named as the reason to extract in the first place. No `@jini/ui`
component calls it yet — this dispatch adds the capability and the dependency edge; wiring it into
an actual component is not part of this task and was not asked for.

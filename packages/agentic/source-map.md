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

## Known metadata gap: `jini.runtime` cannot express two runtimes

`package.json`'s `jini.runtime` is a single value (`universal | node | browser | desktop`), and
`scripts/check-engine-boundaries.ts` validates exactly one. This package's root is universal but
`./dom` is browser-only — no single value is honest. Set to `"universal"` here (the root entry is
the dominant, dependency-free half; `./dom` is the smaller addendum), per plan §6's own flag of
this exact gap. The plan's step 8 (extending the metadata model to a per-entry `jini.entries` map,
or documenting the exception formally) is explicitly **out of scope** for the 2026-07-26 extraction
that created this package — this note exists so the gap is not rediscovered as a surprise.

## Admission

`jini.admission: "admitted"`, `UNLOCKED.md` status `"stable"`, recorded at package creation rather
than going through the normal incubating → stable promotion gate. Reasoning: this is a relocation
of code that was already inside a `locked` package (`chat-core`) and already had 615+393 tests
passing against it; downgrading it to `incubating` on the day it moved would have blocked the very
imports (`chat-core`, `chat-react` are both `locked`) the extraction exists to serve — `incubating`
packages cannot be imported by `locked` ones. See `UNLOCKED.md`'s entry for the exact note.

## Dependencies

None beyond the TypeScript standard library — same as `chat-core/agentic` before it. `src/dom/`
depends on the DOM lib (a `lib`, not a package dependency) and on this package's own sibling
modules; nothing else.

## Not ported / explicitly deferred (inherited from before the move, not new)

- `page-driver.ts` and `page-capabilities.ts` have no dedicated test file — pre-existing before
  this extraction; `capability.test.ts`'s own comment already noted this (their behavior is
  exercised indirectly through `page-executor.test.ts` and `capability.test.ts`'s manifest-shape
  checks). Not introduced or fixed by this move.
- `handle.ts` (`agentHandle()`) and folding `model-context.ts` into `webmcp.ts` — plan §8 steps 5
  and 6, a separate follow-up dispatch.

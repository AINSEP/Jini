# packages/agentic — post-merge audit findings to verify and fix

Source: independent OpenAI Codex (gpt-5.6-sol, high reasoning) peer review of the production-source
diff for `packages/agentic` between `9cb4ffc50` (base) and `085c4799a` (merge of
`feat/agentic-capability-layer` into `main`). This package contains the a2ui protocol interpreter, a
DOM page-driver, gen-ui/, and a webmcp.ts/mcp-ui-apps.ts surface. Two of the commits that produced
this code were self-flagged by their own author as "checkpoint, unreviewed" — treat this as
genuinely never independently reviewed, not just untested. Codex reproduced several of these
against the built package rather than relying on static reading alone. Four of these have already
been independently spot-verified by the coordinating human/session (marked below); the rest have
not — treat every unmarked one as a hypothesis to confirm against current source, not a given fact.

**IMPORTANT — check for prior work first:** a separate local fix-agent may have already worked on
these same findings on a LOCAL branch named `fix/post-merge-audit-agentic-2026-07-29` that only
exists on one specific machine and was never pushed to origin (so you cannot see it from this cloud
environment). You are being dispatched as a redundant, independent safety net in case that local run
didn't finish. Do the full verify-and-fix work yourself as if starting fresh — do not assume it's
already done. If your work turns out to duplicate the local run, that's fine; a human will reconcile
the two in the morning.

## BLOCKING

1. **Sensitive field values can bypass the read guard** (`dom-page-driver.ts:105`, `:368`;
   `page-executor.ts:142`) — NOT YET independently verified. Claim: the element-labeling logic
   selects only the first of `aria-label`/placeholder/associated-label, so an innocuous placeholder
   can mask a sensitive visible label (e.g. a `name="field_47"` input labeled "Card number" with
   placeholder "Enter value" allegedly leaks the label+value anyway through
   `page.find_elements({withState:true})`). Separately, contenteditable text content is allegedly
   emitted even when the field should be refused — e.g. `<div contenteditable
   name="password">hunter2</div>` allegedly returns `text: "hunter2"` verbatim. Read the actual
   guard/refusal logic (search for where "sensitive" fields get detected/withheld — likely near
   `normalizeAgentLabel`, any `sensitive`/`redact`/`mask` naming, and how `text`/`value` get
   attached to a found element) and confirm whether real sensitive-content values actually reach
   the caller.

2. **Disabled dropdowns remain writable** (`dom-page-driver.ts:479`) — ALREADY SPOT-VERIFIED, REAL.
   `selectOption` filters `Array.from(control.options).filter(entry => !entry.disabled)` — a
   per-`<option>` check only. It never checks `control.disabled` or `control.matches(':disabled')`
   (which in a real browser also reflects an ancestor `<fieldset disabled>`). The nearby comment
   states the intent ("a way around the page's own rule") the code doesn't actually enforce. Fix:
   reject the whole operation (or filter it out entirely) when the control itself is disabled,
   matching what a real user could do.

3. **Required A2UI `value` fields are not actually required** (`agent-to-renderer.ts:86`,
   `renderer-to-agent.ts:32`, `interpreter.ts:195`) — NOT YET independently verified. Claim: these
   schemas use `z.unknown()` for a field that's supposed to be required, and in Zod 3 that accepts a
   missing property — so `{updateDataModel:{surfaceId:"s"}}` (no `value`) allegedly parses
   successfully and `interpreter.ts:195` replaces the entire model with `undefined`, silently.
   Verify by reading the actual schema definitions and interpreter logic.

4. **The resolver's "never throws" invariant is false** (`resolve.ts:121`, `:58`) — NOT YET
   independently verified. Claim: `resolve.ts:121` invokes catalog implementations with no
   argument-schema enforcement or exception handling, so a wrong-typed argument from an agent can
   make `applyAgentMessage` throw through the renderer. Separately, `resolve.ts:58` allegedly
   misclassifies `{path: 7}` as a binding (should require `path` to be a string) and then throws on
   `path.startsWith` when `path` is actually a number. Verify both independently.

5. **JSON Pointer resolution traverses and can alter object prototypes** (`json-pointer.ts:75`,
   `:147`) — ALREADY SPOT-VERIFIED, REAL WITH A NUANCE. The read side (`token in record`) does
   check the prototype chain — `getAtPointer({}, "/constructor")` really does resolve to the
   inherited `Object` constructor instead of correctly reporting "not found". The write side
   (`record[lastToken] = value` where `lastToken` can be `"__proto__"`) does mutate that ONE
   returned object's actual `[[Prototype]]` via the inherited `Object.prototype.__proto__`
   accessor-setter — real, but narrower than classic global "prototype pollution": it does not
   poison the global `Object.prototype` for the whole process, only the specific object being
   constructed. Fix both: use `Object.prototype.hasOwnProperty.call(record, token)` (or
   `Object.hasOwn`) instead of `in` for reads, and either reject/no-op `__proto__`/`constructor`/
   `prototype` tokens on write, or build the new object so the accessor can't fire.

6. **Untrusted A2UI trees can exhaust the stack** (`tree.ts:50`) — ALREADY SPOT-VERIFIED, REAL.
   `flattenRenderTree`'s inner `visit()` is a plain recursive function with no depth cap and no
   iterative fallback. A sufficiently deep (but valid, acyclic) component chain genuinely blows the
   JS call stack (`RangeError: Maximum call stack size exceeded`). Fix: convert to an iterative
   (explicit-stack) traversal, and/or add an explicit max-depth (and ideally max-node-count) guard
   that fails closed with a clear error rather than crashing.

7. **The attacker-facing JSON-RPC type guard accepts malformed messages** (`mcp-ui-apps.ts:197`) —
   NOT YET independently verified. Claim: the type guard accepts any object with a string `method`
   without validating `params` or excluding response-only fields, and a message with both `result`
   and `error` present also passes. Verify against the actual guard implementation and real
   JSON-RPC 2.0 shape rules (request/notification/success-response/error-response are supposed to
   be mutually exclusive shapes).

## NON-BLOCKING (fix only if small/obviously correct; otherwise just note in your report)

- `ag-ui.ts:94` — `JSON.stringify` can throw (BigInt/circular) or return `undefined` for some
  inputs, allegedly violating a `content: string` contract somewhere. Verify and note or fix.
- `dom-page-driver.ts:533` — `navigate("constructor")` allegedly resolves an inherited property
  from the `pages` object despite the code claiming to enforce an allowlist. Verify and note or fix.
- Add focused regression tests for these adversarial cases generally, since high aggregate coverage
  did not catch any of them.

## What to do

For each finding: read the actual current source and confirm or refute the claim yourself,
independently — even the four marked "already spot-verified," re-confirm them too. If it's a false
positive, say exactly why and don't change the code. If it's real: write a FAILING TEST FIRST
reproducing it (in the relevant existing test file, following its conventions), confirm it fails
against current unfixed code, THEN implement the minimal correct fix, THEN confirm the test passes
and the package's full test suite has zero regressions. No fix without a preceding red test.

Tests must be genuine and behavioral — no `toBeDefined()` filler, no weakened assertions, no
deleting a branch instead of covering it. If a "fix" would mask rather than solve a bug, say so
explicitly instead of forcing green.

After your changes, run `cd packages/agentic && pnpm test && pnpm typecheck`, and from the repo root
`pnpm guard`. Report the real output you actually saw.

Branch and push (CRITICAL — this is an isolated cloud environment; your work is only retrievable if
you push it): create a new branch off `main` named `fix/post-merge-audit-agentic-cloud-2026-07-30`
(deliberately different from the local branch name above, to avoid any collision if both get pushed
by a human later), commit your work there with a detailed commit message, and PUSH it to origin. Do
NOT push to main, do NOT open a pull request, do NOT merge anything.

Also create `ADS-memory/reports/post-merge-audit-2026-07-29/agentic-cloud-fix-report.md` in your
branch summarizing the same information so a human can review it without digging through commit
history.

Stay inside `packages/agentic` unless a fix genuinely requires touching a direct consumer (e.g.
`chat-react`'s use of a2ui) — confirm before editing outside `packages/agentic`.

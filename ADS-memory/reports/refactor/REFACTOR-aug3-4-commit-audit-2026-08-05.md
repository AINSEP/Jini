# Refactor audit — Aug 3–4 committed range

**Scope:** `7e86dc8b9f417608337e228ee752e5c1192bbf10^..23b9de818c7c2e0a267e95c8f3b9e2228138247b`, restricted to the requested package areas. Evidence is pinned to `23b9de81` (`git show`), not the dirty worktree. No tests, builds, typechecks, or services were run.

**Navigation evidence:** Codebase Memory MCP 0.9.0 was enabled and indexed at `23b9de81`; it identified `splitOnQuestionForms`'s consumers as `MessageRow`, `useQuestionForms`, `MessageList`, and `ChatPane`. Each finding below was then checked against commit-pinned source.

## Ranked findings

### REF-001 — High — architecture violation: exported product composition replaces the locked reusable frontend center

- **Type:** D — structural mismatch. **Route:** `ARCHITECTURE_REVIEW_REQUIRED`, then a staged Refactor implementation.
- **Evidence:** The locked plan requires framework-free `@jini/chat-core`, a thin React binding/slots layer, and explicitly says to export small controllers, **not** a product-like `ChatPane` ([`extraction-plan.md:215-219`](../../../foundry/docs/jini-port/extraction-plan.md#L215)). The committed package instead collapses the two into `@jini-ai/chat` with `/core` and `/react` subpaths ([`packages/chat/package.json:2-4,15-40`](../../../packages/chat/package.json#L2)); its public React barrel exports the full chat-pane slice ([`packages/chat/src/react/index.ts:29-33`](../../../packages/chat/src/react/index.ts#L29)), while `ChatPane` owns runtime inventory polling, working-directory selection, file drop/upload, agent control, conversation and composer orchestration, plus rendering ([`packages/chat/src/react/features/chat-pane/react/components/ChatPane.tsx:310-465`](../../../packages/chat/src/react/features/chat-pane/react/components/ChatPane.tsx#L310)).
- **Why this matters:** A Vue or non-React host cannot reuse the controller and must either recreate this behavior or import a React-shaped product composition. It also makes future changes to agent selection, filesystem UI, transport, and transcript rendering converge on one 466-line public unit.
- **Non-behavioral proposal:** Restore a framework-free controller package/surface first (session, composer, transcript, run-status, confirmation, attachments). Make React a thin binding around those controllers and slots. Move the opinionated workspace pane to `examples/reference-web` or a clearly optional reference package; do not retain it as the generic engine export. Preserve existing APIs temporarily with deprecated adapters only after the target package boundary is approved.
- **Blast radius / risk:** High: package name/export map, all React consumers, `@jini-ai/ui`, `@jini-ai/agentic`, and external consumer packaging. This must be release-set/packed-tarball verified, not package-local only.
- **Why Refactor rather than Programmer/Security:** The intended behavior already exists; the change is to recover the locked ownership and composition seams. It is not a defect fix. Architect must first confirm the migration/package compatibility decision because it changes public module boundaries.

### REF-002 — Medium — architecture/neutrality violation: MCP timeout is a consumer policy embedded in an engine tool

- **Type:** D — structural mismatch / configuration ownership. **Route:** `ARCHITECTURE_REVIEW_REQUIRED`.
- **Evidence:** The generic MCP tool hardcodes a six-minute timeout ([`packages/mcp/src/server/tools/delegated-tool.ts:36-60`](../../../packages/mcp/src/server/tools/delegated-tool.ts#L36)) explicitly derived from **Tovu**'s 5.5-minute exchange lifetime ([`:45-49`](../../../packages/mcp/src/server/tools/delegated-tool.ts#L45)), then unconditionally overwrites the daemon-client call timeout ([`:124-127`](../../../packages/mcp/src/server/tools/delegated-tool.ts#L124)). The lock requires external consumers to remain consumers, with no product tilt in the engine, and says the engine is headless first ([`START-HERE.md:20-32`](../../../foundry/docs/jini-port/START-HERE.md#L20)).
- **Why this matters:** A consumer with a 30-second interaction budget, or one with a longer approval exchange, cannot express its policy without forking/patching an engine tool. The embedded product reference also defeats source-neutrality/debranding checks.
- **Non-behavioral proposal:** Add a named optional `delegatedToolTimeoutMs` to the tool factory's options (or inject an exchange-deadline policy port); retain six minutes as a documented temporary default only if architecture approves it. Place the Tovu-specific lifetime in the Tovu adapter/configuration and move provenance to `source-map.md`/NOTICE rather than package source.
- **Blast radius / risk:** Medium: MCP server factory, its binary composition call, and timeout tests. No protocol change is necessary if an optional option defaults compatibly.
- **Why Refactor rather than Programmer/Security:** The desired long-poll behavior is unchanged; this moves consumer policy to its owner. The remaining question—whether timeout belongs to host composition or an exchange port—is an architecture choice, not a security finding.

### REF-003 — Medium — duplicated markup-attribute parser creates three drift points in one core contract

- **Type:** B — duplication. **Route:** Refactor implementation after baseline test confirmation.
- **Evidence:** Identical quoted-attribute parsing loops occur in the question-form parser ([`packages/chat/src/core/question-form.ts:241-253`](../../../packages/chat/src/core/question-form.ts#L241)), streaming artifact parser ([`packages/chat/src/core/util/parser.ts:30-43`](../../../packages/chat/src/core/util/parser.ts#L30)), and post-stream artifact stripper ([`packages/chat/src/core/util/strip.ts:167-180`](../../../packages/chat/src/core/util/strip.ts#L167)).
- **Why this matters:** All three interpret model-produced markup. A future correction for escaping, accepted attribute names, malformed quotes, or Unicode keys can silently make live streaming, final rendering, and question forms disagree.
- **Non-behavioral proposal:** Extract the exact current grammar into one non-exported `core/util/markup-attributes.ts` helper and move its existing edge-case coverage to a focused helper suite. Retain the current tolerant semantics byte-for-byte; do not broaden the grammar as part of this refactor.
- **Blast radius / risk:** Medium-low: three internal files and their parser tests. CBM showed the question-form path reaches `MessageRow`, `useQuestionForms`, `MessageList`, and `ChatPane`, so the helper needs both direct unit cases and the existing consumer tests.
- **Why Refactor rather than Programmer/Security:** This consolidates already-identical behavior and reduces future parser divergence; it changes no user-visible contract and does not itself fix a vulnerability.

### REF-004 — Medium — duplicate agent-element grammar has no neutral source of truth

- **Type:** B/D — duplicated contract across packages. **Route:** Architect to select ownership, then Refactor.
- **Evidence:** `@jini-ai/vibecoding/html` deliberately restates the agentic `data-agent-element` grammar, regex, and 128-character cap rather than importing it ([`packages/vibecoding/src/html/regions.ts:57-70`](../../../packages/vibecoding/src/html/regions.ts#L57)). The committed comment acknowledges future widening must be manually revisited ([`:60-63`](../../../packages/vibecoding/src/html/regions.ts#L60)). That grammar is security-significant because it controls which model-addressable document regions become publishable.
- **Why this matters:** A grammar change can make agentic handles and vibecoding regions disagree. The resulting failure is non-local: one package can mint a handle the other rejects, or one can widen a model-addressable surface without the other package's validation following.
- **Non-behavioral proposal:** Extract the handle attribute, grammar, maximum length, and validator into a lower neutral contract (prefer `@jini-ai/protocol` only if it is genuinely cross-transport vocabulary; otherwise a tiny dependency-free shared contract package). Both agentic and vibecoding should consume it. Add a conformance fixture shared by the two packages before deleting the duplicate.
- **Blast radius / risk:** Medium-high: agentic handle producers, vibecoding HTML target validation, and any host parser implementation. The import-direction decision prevents treating this as a blind helper extraction.
- **Why Refactor rather than Programmer/Security:** The motivation is a maintainability/one-source-of-truth correction; the existing validation behavior should remain unchanged. Architect owns the package-placement decision; Security should validate the resulting conformance cases because this grammar gates a model-controlled allowlist.

### REF-005 — Low — question-form module mixes three independently evolving responsibilities

- **Type:** C — oversized unit / testability debt. **Route:** Refactor.
- **Evidence:** One 683-line framework-free module owns complete markup segmentation ([`packages/chat/src/core/question-form.ts:142-177`](../../../packages/chat/src/core/question-form.ts#L142)), tolerant streaming recovery and JSON lexical walking ([`:353-542`](../../../packages/chat/src/core/question-form.ts#L353)), normalization of raw form schema ([`:544-639`](../../../packages/chat/src/core/question-form.ts#L544)), and answer presentation ([`:641-683`](../../../packages/chat/src/core/question-form.ts#L641)).
- **Why this matters:** Changes to streaming completeness rules, input-schema tolerance, and output prose format require navigating the same large module and its large test file, even though they have distinct invariants and consumers.
- **Non-behavioral proposal:** Split into internal `question-form/scan.ts`, `normalize.ts`, and `format.ts`; keep `question-form.ts` as the stable public facade. Keep the parser's current exact outputs and only move existing tests first; add no new format/schema behavior in the split.
- **Blast radius / risk:** Low-medium: public exports stay put; direct consumers include renderer segmentation and question-form hooks. This is safe only after the package's pre-refactor tests are known green—no test run was performed in this audit.
- **Why Refactor rather than Programmer/Security:** This is separation of decision logic from orchestration and an internal test seam improvement, not a behavioral or threat-model change.

## Deliberate non-findings

- I did **not** re-list the delegated event-payload overwrite issue, anonymous delegated principal, history replay-loss issue, or A2UI stale-notice race already raised by the Coordinator. The dirty worktree now contains partial fixes for at least history/A2UI, so this report relies solely on the pinned commit and concentrates on independent maintainability findings.
- I did not treat large React components alone as a violation; presentation code is normally exempt. REF-001 is ranked high because the locked architecture explicitly rejects exporting a product-like `ChatPane`, not because of line count.

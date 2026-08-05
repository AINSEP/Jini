# Verification of REFACTOR-aug3-4-commit-audit — 2026-08-05

Independent check of the five architecture findings in
`ADS-memory/reports/refactor/REFACTOR-aug3-4-commit-audit-2026-08-05.md`.

**Nothing here was implemented.** These are structural refactors, and structural refactor is
propose-only by default — each one changes a package boundary, a public export map, or an ownership
decision that the Architect stage owns. The audit itself routes REF-001/002/004 through
`ARCHITECTURE_REVIEW_REQUIRED`, which is the correct call.

## Verdict: all five confirmed. This is an accurate report.

| ID | Verdict | Verification |
|---|---|---|
| REF-001 | **Confirmed, and the strongest of the five** | The locked plan's C3 says verbatim: *"Export small controllers (session/composer/transcript/run-status/confirmation/attachment), NOT a product-like `ChatPane`."* `packages/chat/src/react/index.ts` contains `export * from './features/chat-pane/index.js'`. A named prohibition and its literal violation. |
| REF-002 | **Confirmed verbatim** | `packages/mcp/src/server/tools/delegated-tool.ts` defines `DELEGATED_TOOL_TIMEOUT_MS = 6 * 60 * 1000` in a comment that explicitly reads "5.5 min in Tovu's `surface-exchanges.ts`", then applies it unconditionally at the call site. |
| REF-003 | **Confirmed, with stronger evidence than the report cites** | The three sites do not merely have equivalent logic — they carry the *same comment text*: "The pattern's quote alternation means exactly one of group 2 (double-quoted) / group 3 (single-quoted) participates in any successful match" appears verbatim in `question-form.ts`, `util/parser.ts`, and `util/strip.ts`. That is copy-paste, provable from the prose. |
| REF-004 | **Confirmed** | `packages/vibecoding/src/html/regions.ts` restates the agentic `data-agent-element` grammar with a comment acknowledging that future widening must be revisited by hand. |
| REF-005 | **Confirmed** | `packages/chat/src/core/question-form.ts` is exactly 683 lines, as cited. |

## Two corrections to the report

- **REF-001's ChatPane path is wrong.** It cites
  `packages/chat/src/react/features/chat-pane/react/components/ChatPane.tsx`; the file is at
  `packages/chat/src/react/features/chat-pane/components/ChatPane.tsx` (no `react/` segment). The
  finding stands — only the line reference is unusable as written.
- **REF-002 is also a debranding leak, not only a policy-ownership one.** The literal string "Tovu"
  sits in generic engine source. The report notes this in passing under "defeats
  source-neutrality/debranding checks"; it deserves to be first-class, because it is the one part of
  REF-002 that is objectively checkable by a grep gate rather than by architectural judgement, and
  therefore the part that can be prevented from recurring automatically.

## Recommended sequencing, if these are taken up

1. **REF-002 first.** Smallest blast radius, and the only one with a mechanical regression gate
   (a debranding grep over engine packages). An optional `delegatedToolTimeoutMs` defaulting to the
   current six minutes is behaviour-preserving.
2. **REF-003 next.** Genuinely local — three internal files, no public contract, and the duplicated
   comment makes the "is this really identical" question trivial to settle.
3. **REF-004 then**, but only after the Architect picks the owning package. The report is right that
   the import-direction decision is what makes this not a blind helper extraction, and right that
   the grammar gates a model-addressable allowlist, so the conformance fixture must exist before the
   duplicate is deleted.
4. **REF-005** is cosmetic relative to the others; it is worth doing as preparation for REF-003
   rather than on its own.
5. **REF-001 last, and only as a staged migration.** It touches the package export map and every
   React consumer plus `@jini-ai/ui` and `@jini-ai/agentic`. The audit's own note that this needs
   packed-tarball verification rather than package-local tests is correct and should be treated as a
   hard gate, per the locked plan's C4 (packaging is already known-broken and is the CI neutrality
   gate).

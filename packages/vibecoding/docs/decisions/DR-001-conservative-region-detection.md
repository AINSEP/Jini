# DR-001: HTML region locations and parsed form guardrails

Status: amended for the HTML region scan and pure edits shipped in aa3b21ca; documentation only.

## Context

A parser may recover malformed HTML by inventing nodes that lack dependable source locations or by dropping authored tags. Silently omitting a handle undermines the strict target's handle-multiset validation. Throwing on every scan is also unsuitable: a host computing region metadata on reads would lose access to the entire page because of one unsafe region. A model retry cannot repair that read failure.

Raw source matching alone mistakes comment and literal-text examples for real handles. Formatting reconstruction can also create several tree nodes for one authored tag, falsely making its handle ambiguous. Text matching can similarly mistake script/comment examples for real forms.

## Decision

Use parse5 source locations in a `<div>` fragment context and expose two contracts:

- `scanHtmlRegions` returns all discovered handles in source order, retaining duplicates and invalid/legacy values. Unsafe boundaries become a per-region `problem`; unaccounted-for source handles become `documentProblem`, and parse errors remain diagnostic reasons. Malformed markup shall not make reads throw or block safe sibling lookup.
- `createParse5RegionParser` delegates to the scan while preserving the strict target boundary. `findRegions` throws on a region/document location problem. `checkWellFormed` rejects those problems and then any parse errors. The target retains grammar checks and its identical-handle-multiset rule.

Before the conservative raw-source cross-check, mask comment and literal-text body ranges using parse5 locations, including RCDATA and `noscript` with scripting enabled. Opening-tag attributes still count. Collapse formatting clones sharing the same authored start offset to one unsafe address, so parser reconstruction cannot invent duplicate handles or borrow a later close as a safe boundary.

Export pure lookup, inner replacement, whole-element move, ambiguity comparison, handle listing and tagging advice over a caller-owned scan. Require safe offsets from the exact unchanged input for splices and moves. The host owns persistence, its original version basis, authorization and handle policy; pure helpers permit handle additions/removals. Suggestion slugification is injected by the host.

Apply form guardrails to actual parsed form nodes, not matches in comments or scripts.

## Consequences and current limits

The universal region contract and pure helpers stay independent of the Node parser adapter. A scan is lenient analysis, not a well-formedness certificate: unsafe regions cannot be edited individually, and entirely dropped tags cannot be returned as located regions. Recovered top-level boundaries support tagging advice only. The strict adapter remains available for consumers needing target validation; the pure path does not implicitly impose it.

Offsets index the untouched UTF-16 input, including CRLF, BOM and astral characters. parse5 recovery determines the tree: a non-void self-closing slash is ignored, an explicit later close can delimit an editable region, unquoted/upper-case attributes are recognized, and `noscript` content is literal text. Regions are sorted by source offset rather than recovered tree order. No region depth is published.

Tovu Pages consumes scans/pure edits directly to preserve its read → compute → write compare-and-swap basis. Its handle policy allows additions/removals and refuses newly worsened ambiguity; it is not a security boundary for a principal already allowed to replace the whole page. Malformed HTML warns without a whole-document read/write refusal. Pages undo restores a saved revision, and Pages has no save rate limit; both are host decisions, so no store adapter or second history mechanism is introduced here.

## Defect prevented

Malformed-input recovery silently removing protected handles, a single unsafe region making page reads fail, parser-created clones inventing ambiguity, source splices using guessed boundaries, or text examples triggering a handle/form guardrail.

## Source and enforcement

Amends the inherited conservative-detection rationale with the binding Phase A review's distinction between non-throwing analysis and strict target validation. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [parser and scan](../../src/html/node/parse5-region-parser.ts), [pure helpers](../../src/html/edit.ts), [scan recovery fixtures](../../src/html/node/__tests__/scan.test.ts) and [edit compatibility fixtures](../../src/html/__tests__/edit.test.ts).

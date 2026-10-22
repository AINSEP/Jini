# DR-001: HTML region locations and parsed form guardrails

Status: recorded from existing design; no runtime changes.

## Context

A parser may recover malformed HTML by inventing nodes that lack dependable source locations. Silently dropping a tagged region makes edit validation believe the original handle disappeared, permitting an unrelated edit to lose it. Text matching can also mistake script/comment examples for real forms.

## Decision

Use the HTML parser's source location data to identify tagged region bounds. Do not silently discard tagged elements whose bounds cannot be proven; mark the structural failure so the edit target refuses the edit. Find regions in a context that preserves fragment location behavior and preserve duplicate/invalid handles for target validation. Apply form guardrails to actual parsed form nodes, not matches in comments or scripts.

## Consequences and current limits

The universal region contract stays independent of the Node parser adapter. Unlocatable regions become actionable failures. Parser recovery behavior is characterized rather than assumed; emitted offsets must remain valid for the exact input text.

## Defect prevented

Malformed-input recovery silently removing protected handles, source splice editing the wrong bytes, or a form-like example in script text triggering a guardrail rewrite.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/html/node/parse5-region-parser.ts](../../src/html/node/parse5-region-parser.ts).

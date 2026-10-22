# DR-001: Extension attachment vocabulary and containment

Status: recorded from existing design; no runtime changes.

## Context

An extension manifest can express more call sites than the current host wires. Silently accepting an unwired category looks successful without doing anything; applying fail-isolation uniformly is unsafe for write-path invariants.

## Decision

Keep a closed attachment vocabulary and explicitly partition wired and unwired categories. Validate known categories, then reject unsupported dispatch at load time. Inject capability-mediated host operations instead of raw filesystem/network/process handles. Propagate content-write handler failures; isolate noncritical hooks according to category policy and report denied capability plus module identity.

## Consequences and current limits

A manifest schema accepting a category does not mean runtime support exists. The original design's separate authored-extension packaging was later reconsidered; this record preserves the portable attachment/capability/containment contract, not a requirement to build two extension runtimes.

## Defect prevented

An accepted attachment that never runs, a caught write-guard exception letting invalid data commit, or a denied invocation losing the capability/module evidence required to diagnose it.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/glue/manifest.ts](../../src/glue/manifest.ts), [src/glue/capability-gate.ts](../../src/glue/capability-gate.ts).

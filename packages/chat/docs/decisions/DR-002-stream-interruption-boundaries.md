# DR-002: Interruption event ordering

Status: recorded from existing design; no runtime changes.

## Context

The engine emits text and reasoning fragments without explicit message-start/end events. A tool-use event can interrupt one fragment run before more text arrives. A protocol client may reject a second START without an intervening END.

## Decision

Synthesize text and reasoning boundaries in the transport adapter. Close an open message/reasoning segment before a tool-use interruption and open a new segment when text resumes. Preserve ordering for sequences such as text → tool use → text, not merely uninterrupted happy-path text.

## Consequences and current limits

The transport adapts the existing engine lifecycle; it does not create another execution path or permission boundary. Protocol schema types and encoding should follow the actual supported protocol rather than handwritten approximations.

## Defect prevented

A protocol client rejecting double-START events without an END, or losing text when a tool interrupts the message stream.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/core/ag-ui/__tests__/translation.test.ts](../../src/core/ag-ui/__tests__/translation.test.ts).

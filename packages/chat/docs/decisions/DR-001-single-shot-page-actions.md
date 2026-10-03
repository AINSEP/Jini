# DR-001: Single-shot post-navigation actions

Status: recorded from existing design; no runtime changes.

## Context

A page action that follows navigation needs to survive reload, but a queued action can be stale or malformed. Reading and applying without removing first lets remount/reload replay the same effect.

## Decision

Persist a bounded, typed post-navigation queue and consume an action once before applying it. Reject malformed entries safely. Keep target resolution and trust validation in the capability/server boundary; the widget's own pane is outside page-action target discovery.

## Consequences and current limits

Hosts own navigation/storage integration and validation of server-issued directives. Browser adapters consume validated capabilities rather than widening the action set or trust based on conversation history.

## Defect prevented

Reload replaying a drained action, a poisoned queue entry throwing during rehydration, or page actions selecting the chat widget itself.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/embed-widget/browser/__tests__/session-store.test.ts](../../src/embed-widget/browser/__tests__/session-store.test.ts), [src/embed-widget/browser/__tests__/page-actions.test.ts](../../src/embed-widget/browser/__tests__/page-actions.test.ts).

# DR-003: Human surfaces survive reconnect with honest status

Status: recorded from existing design; no runtime changes.

## Context

A reconnect can show an unanswered historical card while the live run has already completed, or fail to show a parked surface at all. Distinct questions in one run must retain separate identities; a queued prompt flushed during mount must not be discarded.

## Decision

Rehydrate persisted human-surface events with their own correlation identities and current interaction status. Render answered, expired and orphaned exchanges honestly. Keep surface subscriptions/effects owned by one hook and preserve queued prompt handoff through the same commit that mounts the conversation. Hosts supply persisted history and live reattachment; the generic UI does not invent missing server records.

## Consequences and current limits

A renderer registry must cover supported human-input event kinds. A resource URI is an opaque identity, not proof that a card is still answerable. Reconnection is a host/UI cooperation boundary. Persist a nonterminal run identifier early enough for a remount to discover it. Keep the run-stub write's dedup state separate from settled-message persistence, and converge both writes on one stable message identity; otherwise the early stub can suppress the final reply forever.

## Defect prevented

An invisible question blocking a live run, an expired card still inviting an answer, two cards sharing answer state, or a mount-time queued prompt silently disappearing.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/react/hooks/useConversation.ts](../../src/react/hooks/useConversation.ts), [src/react/components/McpUiSurfaceCard.tsx](../../src/react/components/McpUiSurfaceCard.tsx).

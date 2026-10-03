# DR-003: Settings ledger, total reads and scope fences

Status: recorded from existing design; no runtime changes.

## Context

Mutable settings need an audit trail and a safe default even when no explicit layer value exists. A renamed key must keep addressing its old values. A user-layer write is also a cross-principal operation when its target differs from the caller.

## Decision

Keep stable setting identities, owner-specific namespaces, validated defaults and user/workspace/global/default precedence. Reject secrets and global scope on workspace-owned definitions. Write values and revisions together. Rename through a one-hop alias marker; retype through a new definition version and an explicit total coercer. Derive self-versus-other user permission in one place and validate other targets as active users in the same workspace. Purge appends redacted revisions before deleting values. Reset's internal clear calls inherit its reset-authorized context.

## Consequences and current limits

Reset bypass flags are internal authority and must not come from untrusted requests. Defaults/coercers must satisfy their schemas and totality through host registration; current raw alias resolution lacks a cycle bound, and an unregistered coercer falls back to identity. These are current limits, not stronger safety promises. Revisions survive tenant teardown.

## Defect prevented

A fail-open self-write permission used to modify another user, a setting row without its revision, secrets exposed through generic settings, rename-orphaned values, or teardown erasing audit history.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/settings/settings.ts](../../src/settings/settings.ts), [src/settings/write-service.ts](../../src/settings/write-service.ts), [src/settings/purge-service.ts](../../src/settings/purge-service.ts).

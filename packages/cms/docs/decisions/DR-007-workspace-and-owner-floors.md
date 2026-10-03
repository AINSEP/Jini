# DR-007: Workspace survival and meaningful updates

Status: recorded from existing design; no runtime changes.

## Context

Deleting the last workspace makes an installation unbootable. Even a single-process service can interleave async count-and-delete operations. An empty update also hides client bugs by appearing successful without doing anything.

## Decision

Refuse deletion of the last remaining workspace and serialize the count check and delete within the repository transaction. Require at least one name or slug field on update. Check slug uniqueness while excluding the updated row itself. Keep destructive workspace deletion out of agent-tool wiring where the host does not offer an explicit confirmation path.

## Consequences and current limits

An unchanged slug is valid and an empty update is rejected. Host routes authenticate, authorize and enforce tenant/path equality; the library slice alone is not an authentication boundary. A transaction port must provide real serialization across its actual writer boundary.

## Defect prevented

Two async deletes each observing another workspace and jointly reaching zero, rejecting a workspace's own slug as a duplicate, or silently accepting a dropped update payload.

## Source and enforcement

Restated from inherited design and review reasoning. Historical provenance is kept outside the engine. The current behavior contract and local code establish the enforcement boundary; this record adds no runtime behavior.

Evidence: [src/workspace/delete.ts](../../src/workspace/delete.ts), [src/workspace/update.ts](../../src/workspace/update.ts), [src/workspace/tool-registrations.ts](../../src/workspace/tool-registrations.ts).

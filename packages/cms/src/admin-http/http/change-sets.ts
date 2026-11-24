import type { ChangeSetItemRecord } from "@jini-ai/core/contracts/events";

/**
 * @file HTTP response serializers for change sets (SPEC-001 api.spec §5).
 *
 * `inversePayload` is intentionally NEVER exposed over HTTP — it may hold full
 * content snapshots. Items expose a `revertible` boolean instead.
 *
 * The header serializer is the host's model-facing change-set view (shared with its agent tool), so
 * the host passes it to the change-set route specs as `toChangeSetHeader`; only the item shape lives here.
 */

/** One change-set item as the admin API answers it: `revertible` instead of the inverse payload. @complexity O(1). */
export function toChangeSetItemResponse({ item }: { item: ChangeSetItemRecord }, _optional: Record<string, never> = {}) {
  return {
    id: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    revertible: item.inversePayload !== undefined,
    entityVersionAtApply: item.entityVersionAtApply ?? null,
    position: item.position,
  };
}

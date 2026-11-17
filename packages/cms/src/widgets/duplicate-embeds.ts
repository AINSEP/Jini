import type { JsonObject } from "@jini-ai/core/primitives";

/**
 * @file Duplicating a rich-text document that carries widget embeds.
 *
 * A document's `bodyJson` can carry `widgetEmbed` nodes. The embed write path (`embed-service.ts`'s
 * `collectEmbeds`/`widgetEmbedNode`) reads and writes nodes whose `attrs` carry BOTH `placementId`
 * AND `widgetEntryId`: `collectEmbeds` requires `typeof node.attrs.widgetEntryId === "string"` to even
 * recognize the node as an embed.
 *
 * `placementId` is a per-document embed-SLOT identifier: it exists only so removing or reordering
 * embeds can address "this occurrence" within one host document, and every real lookup combines it
 * with that document's own entry id (`embed-service.ts`'s `loadHostEntry` +
 * `removeEmbedByPlacementId` — there is no placement table keyed by `placementId` alone).
 * `widgetEntryId` is the actual live reference to a reusable widget INSTANCE, and referencing the
 * same instance from multiple host documents at once is the intended, supported shape of a widget —
 * the same footer widget embedded on every page is the normal case.
 *
 * A byte-for-byte `bodyJson` copy therefore carries the source document's `placementId` values
 * verbatim onto the new row. Today's addressing (`hostEntryId` + `placementId` together) means that
 * alone cannot corrupt the source document — but nothing documents `placementId` as scoped rather
 * than globally unique, and a future caller assuming global uniqueness is a reasonable mistake a
 * duplicate should not manufacture two live examples of. {@link copyBodyJsonWithFreshEmbedPlacements}
 * removes the ambiguity at the one place it is free to remove: every copied embed gets a FRESH
 * `placementId` (minted by the injected generator, the same way every other embed mutation mints
 * one), while `widgetEntryId` is carried over unchanged — reusing the same widget instance across
 * the original and the copy is the intended behavior of a widget, not the trap this function exists
 * to close.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Refresh only addressable embed slots; malformed embeds remain structural copies. */
function refreshEmbedPlacement(
  { node, newPlacementId }: { node: Record<string, unknown>; newPlacementId: () => string },
  _optional = {}
): Record<string, unknown> {
  return node.type === "widgetEmbed" && isPlainObject(node.attrs) && typeof node.attrs.placementId === "string"
    ? { ...node, attrs: { ...node.attrs, placementId: newPlacementId() } }
    : node;
}

type EmbedCopyFrame = { node: unknown; place: (required: { value: unknown }, optional?: Record<string, never>) => void };

function queueEmbedObject(
  { node, place, stack, newPlacementId }: { node: Record<string, unknown>; place: EmbedCopyFrame["place"]; stack: EmbedCopyFrame[]; newPlacementId: () => string },
  _optional = {},
): void {
  const source = refreshEmbedPlacement({ node, newPlacementId });
  const copy: Record<string, unknown> = {};
  place({ value: copy });
  // Clone every field, including leaf text nodes, marks and nested attrs; walking only content
  // would leave the copy sharing mutable objects with its source.
  const entries = Object.entries(source);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) throw new Error("Embed copy has no source entry at its recorded position");
    const [key, value] = entry;
    stack.push({ node: value, place: ({ value: cloned }, _optional = {}) => { copy[key] = cloned; } });
  }
}

function walk({ root, newPlacementId }: { root: unknown; newPlacementId: () => string }, _optional = {}): unknown {
  // An explicit stack, not recursion: a duplicated page's nesting depth is caller/import-controlled
  // and a 5000-deep body overflowed the call stack here (same class as the read-path
  // walkers). Each frame carries where its copied value goes; children are pushed in reverse so
  // the walk stays pre-order and `newPlacementId` is called in document order, exactly as the
  // recursive version did.
  let result: unknown;
  const stack: EmbedCopyFrame[] = [{ node: root, place: ({ value }, _optional = {}) => { result = value; } }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) throw new Error("Embed copy has no frame to process");
    const { node, place } = frame;
    if (Array.isArray(node)) {
      const copy: unknown[] = [];
      copy.length = node.length;
      place({ value: copy });
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], place: ({ value }, _optional = {}) => { copy[i] = value; } });
    } else if (!isPlainObject(node)) {
      place({ value: node });
    } else {
      queueEmbedObject({ node, place, stack, newPlacementId });
    }
  }
  return result;
}

/**
 * Deep-clones a rich-text `bodyJson` document, minting a fresh `placementId` on every `widgetEmbed`
 * node it contains (see this file's header for why). Every other node, attribute, and mark is
 * copied unchanged — including a `widgetEmbed` node's `widgetEntryId`, which is deliberately carried
 * over rather than regenerated.
 *
 * A document with no `widgetEmbed` nodes at all (the common case) round-trips as a plain structural
 * clone with no minted ids spent.
 *
 * @complexity O(n) in the size of `bodyJson` — one iterative walk, no repeated work, no backtracking.
 */
export function copyBodyJsonWithFreshEmbedPlacements({ bodyJson, newPlacementId }: { bodyJson: JsonObject; newPlacementId: () => string }, _optional = {}): JsonObject {
  return walk({ root: bodyJson, newPlacementId }) as JsonObject;
}

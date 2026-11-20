export interface BackstopMetadata {
  readonly mode: "backstop";
  readonly reason: string;
  readonly sourceActor: string;
  readonly destinationHost: string;
  readonly gapLabels: readonly string[];
}



/**
 * One packed entity — the export side's unit of work, and the import side's unit of comparison.
 * Produced by {@link PublishContentHandler.pack}, compared against a stored baseline by the
 * planner (Task 5), and handed back to {@link PublishContentHandler.apply} unchanged when an
 * import proceeds.
 */
export interface PackedEntity {
  readonly backstop?: BackstopMetadata;
  /** Must equal the owning {@link PublishContentHandler.entityType} — carried on the entity
   *  itself (not just implied by which handler produced it) so a bundle's `entities[]` array is
   *  self-describing once serialized, with no positional/grouping convention to preserve. */
  readonly entityType: string;
  readonly id: string;
  /** Version of this entity type's serialized `state` shape. This is independent of
   *  {@link hashVersion}: changing canonicalization does not necessarily change the wire DTO, and
   *  changing the DTO does not necessarily change hashing. Importers accept only the exact version
   *  declared by the registered handler unless an explicit migration is added. */
  readonly schemaVersion: number;
  readonly contentHash: string;
  /** Which `canonicalize`/`contentHash` generation produced {@link contentHash} — see
   *  `content-hash.ts`'s own header for why a mismatch must refuse the whole run rather than being
   *  treated as an ordinary conflict. */
  readonly hashVersion: number;
  /** Blob sha256s this entity needs present on the destination before it can be applied (e.g. an
   *  embedded image). Always `[]` for a handler that has not yet been taught to detect its own
   *  blob references — an empty list is a disclosed "this type has no blob dependency yet", never
   *  silently wrong, since a handler that DOES depend on a blob must list it or the destination can
   *  apply the entity before the blob exists. */
  readonly requiredBlobs: readonly string[];
  /** The entity's own field bag, in the exact shape {@link PublishContentHandler.apply} expects
   *  to receive back. Never `contentHash`'s CANONICALIZED form — that is a derived comparison key,
   *  not a wire shape a handler should have to reverse. */
  readonly state: Record<string, unknown>;
  /** What a human calls this entity, when its handler knows a better name than any `state` field
   *  (a theme tree's `theme.json` name). Display text only: outside `state`, so never hashed and
   *  never applied — changing it can never make a row look changed. Omitted when `state` already
   *  names the entity (`planner.ts`'s `packedEntityLabel`). */
  readonly displayLabel?: string;
}

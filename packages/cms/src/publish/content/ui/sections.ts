/**
 * @file The neutral mechanics of a publishable-section table: the {@link PublishSection} shape, a
 * builder that keeps `entityTypes` and the label maps in step, and the lookups over a table. The TABLE
 * itself — which entity types a host publishes and what they are called — is host policy and is
 * injected as `sections` into every lookup (K5); nothing here names a product's entity types.
 *
 * `labelKey`/`descriptionKey`/`typeLabelKeys` are English copy keys; the host resolves them through its
 * own dictionary. Pure data, no runtime dependency (see `index.ts`).
 */

export interface PublishSection {
  /** Stable id a list page names its button by, e.g. `<PublishSectionButton section="forms" />`. */
  readonly section: string;
  /** Everything this section's button sends — the dialog's `scope.entityTypes`, verbatim. */
  readonly entityTypes: readonly string[];
  /** Button label and the section-scoped dialog's title. */
  readonly labelKey: string;
  /** The section-scoped dialog's description line. */
  readonly descriptionKey: string;
  /** Friendly name per entity type, shown in the dialog's type column. */
  readonly typeLabelKeys: Readonly<Record<string, string>>;
  /** The same names, plural — the dialog's counted lines ("Forms (7) can't publish yet…"). Same keys
   *  as `typeLabelKeys`, enforced by `section()`'s signature. */
  readonly typePluralLabelKeys: Readonly<Record<string, string>>;
}

/** @complexity O(sections). */
export function publishSectionById({ id, sections }: { id: string; sections: readonly PublishSection[] }, _optional = {}): PublishSection | undefined {
  return sections.find((candidate) => candidate.section === id);
}

/**
 * The section whose `entityTypes` is exactly this set (order-insensitive), or `undefined` — a
 * scope naming some other mix of types is not any one section's button.
 *
 * @complexity O(sections × types).
 */
export function publishSectionForEntityTypes({ entityTypes, sections }: { entityTypes: readonly string[]; sections: readonly PublishSection[] }, _optional: Record<string, never> = {}): PublishSection | undefined {
  const wanted = new Set(entityTypes);
  return sections.find(
    (candidate) =>
      candidate.entityTypes.length === wanted.size && candidate.entityTypes.every((type) => wanted.has(type)),
  );
}

/** The friendly type name for the dialog's type column, or the raw `entityType` for a type no
 *  section names yet (degraded, never blank). @complexity O(sections). */
export function publishEntityTypeLabel({ entityType, sections }: { entityType: string; sections: readonly PublishSection[] }, _optional = {}): string {
  for (const candidate of sections) {
    const label: string | undefined = (candidate.typeLabelKeys as Readonly<Record<string, string>>)[entityType];
    if (label !== undefined) return label;
  }
  return entityType;
}

/** The plural friendly name for a counted line, or the raw `entityType` for a type no section names
 *  yet (degraded, never blank). @complexity O(sections). */
export function publishEntityTypePluralLabel({ entityType, sections }: { entityType: string; sections: readonly PublishSection[] }, _optional = {}): string {
  for (const candidate of sections) {
    const label: string | undefined = (candidate.typePluralLabelKeys as Readonly<Record<string, string>>)[entityType];
    if (label !== undefined) return label;
  }
  return entityType;
}

/** Builds one section row, deriving `entityTypes` from the type-label keys so the three can never
 *  disagree. The host's table is made of these. */
export function definePublishSection<const S extends string, const T extends Record<string, string>>({ id, labelKey, descriptionKey, typeLabelKeys, typePluralLabelKeys }: { id: S; labelKey: string; descriptionKey: string; typeLabelKeys: T; typePluralLabelKeys: { readonly [K in keyof T]: string } }, _optional = {}): {
  section: S;
  entityTypes: readonly (keyof T & string)[];
  labelKey: string;
  descriptionKey: string;
  typeLabelKeys: T;
  typePluralLabelKeys: { readonly [K in keyof T]: string };
} {
  return {
    section: id,
    entityTypes: Object.keys(typeLabelKeys) as (keyof T & string)[],
    labelKey,
    descriptionKey,
    typeLabelKeys,
    typePluralLabelKeys,
  };
}

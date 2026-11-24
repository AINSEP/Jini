/**
 * @file Publishable-section contract. Types only; one row of a host's table of publishable sections:
 * each admin list page's "Publish …" button, the publish dialog's title/description for a
 * section-scoped run, and the dialog's type column all read the same row.
 *
 * A section sends its WHOLE `entityTypes` list: a collection is its content type plus its entries,
 * a category group is its taxonomy plus its terms.
 *
 * `labelKey`/`descriptionKey`/`typeLabelKeys` are English copy keys; the admin resolves them through
 * its own dictionary.
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
   *  as `typeLabelKeys`, enforced by the host table's row builder signature. */
  readonly typePluralLabelKeys: Readonly<Record<string, string>>;
}

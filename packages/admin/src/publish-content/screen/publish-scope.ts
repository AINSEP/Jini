/**
 * @file Publish sections plan §2 S2 — the pure label rules behind the dialog's title,
 * its idle-state primary button, and its description line. Kept here rather than inline in the
 * host's Publish dialog component or its confirm hook so both read the SAME rules and
 * they can be unit tested without mounting the dialog. The per-section copy itself lives in the host's
 * one section table (plan G1), which the host hands in as `sectionForEntityTypes`.
 */

/** The slice of the dialog's publish scope these rules read (the host's publish-content dialog
 *  contract's `PublishScope` satisfies it structurally). */
export interface PublishScopeSlice {
  readonly entityTypes?: readonly string[] | undefined;
  readonly entityKeys?: readonly string[] | undefined;
}

/** The slice of one host section-table row these rules read: its copy keys. */
export interface PublishScopeSection {
  readonly labelKey: string;
  readonly descriptionKey: string;
}

/** The host's section-table lookup: the ONE section whose whole entity-type set equals
 *  `entityTypes`, or `undefined` when no section matches exactly. */
export type PublishSectionForEntityTypes = (args: { entityTypes: readonly string[] }) => PublishScopeSection | undefined;

/** What both rules take: the dialog's scope plus the host's section-table lookup. */
export interface PublishScopeRuleArgs {
  scope: PublishScopeSlice | undefined;
  sectionForEntityTypes: PublishSectionForEntityTypes;
}

/**
 * The English copy key for a scope's dialog title / idle-state primary label, resolved through the
 * screen's own `Translate` at the call site (this module knows nothing about locales).
 *
 * - No `scope` at all (or an `entityTypes` that is not exactly one section's set) reads as publishing
 *   everything.
 * - `entityKeys` (non-empty) always wins and reads as a single-item publish, regardless of what
 *   `entityTypes` also carries — plan §1's "a per-row dialog is titled 'Publish item'".
 * - An `entityTypes` equal to one section's whole set, with no `entityKeys`, reads as that section's label.
 *
 * An empty `entityKeys` array is treated the same as an absent one, matching `PublishScope`'s own
 * contract (the publish-content dialog contract): emptiness is never a real selection here, only "nothing narrowed yet".
 *
 * @complexity O(sections × types).
 */
export function publishScopeTitleKey({ scope, sectionForEntityTypes }: PublishScopeRuleArgs, _options: Record<string, never> = {}): string {
  const section = scopeSection({ scope, sectionForEntityTypes });
  if (section === ITEM) return "Publish item";
  return section === ALL ? "Publish all content" : section.labelKey;
}

/** Owner decision 2026-09-25 — the dialog's description line. The unscoped sentence is unchanged;
 *  a section's own line (`PublishSection.descriptionKey`) names only what that dialog sends. */
const ALL_CONTENT_DESCRIPTION = "Sends your posts, pages and media to the live site. Deploy ships code; publish ships content.";

/**
 * The English copy key for the dialog's description line — the same scope resolution as
 * {@link publishScopeTitleKey}, so a dialog's title and its description can never name different
 * sections.
 *
 * @complexity O(sections × types).
 */
export function publishScopeDescriptionKey({ scope, sectionForEntityTypes }: PublishScopeRuleArgs, _options: Record<string, never> = {}): string {
  const section = scopeSection({ scope, sectionForEntityTypes });
  if (section === ITEM) return "Sends this item to the live site.";
  return section === ALL ? ALL_CONTENT_DESCRIPTION : section.descriptionKey;
}

const ITEM = Symbol("item");
const ALL = Symbol("all");

/**
 * The one scope resolution behind {@link publishScopeTitleKey} and {@link publishScopeDescriptionKey}
 * (rules on {@link publishScopeTitleKey}): a single item, everything, or one section.
 *
 * @complexity O(sections × types).
 */
function scopeSection({ scope, sectionForEntityTypes }: PublishScopeRuleArgs, _options: Record<string, never> = {}): typeof ITEM | typeof ALL | PublishScopeSection {
  if (scope?.entityKeys !== undefined && scope.entityKeys.length > 0) return ITEM;
  if (scope?.entityTypes === undefined) return ALL;
  return sectionForEntityTypes({ entityTypes: scope.entityTypes }) ?? ALL;
}

/** Public entry read contracts and vocabulary; no repositories or registration wiring. */

/** Every collection-list presentation the host theme's entry-list renderer renders. `accordion` (an FAQ
 *  disclosure list) and `carousel` (a scroll-snap track of cards) were added for AW-7's zero-code
 *  Testimonials + FAQ plugin (2026-10-04). */
export const COLLECTION_LIST_LAYOUTS = ["cards", "list", "accordion", "carousel"] as const;
export type CollectionListLayout = (typeof COLLECTION_LIST_LAYOUTS)[number];

/** Whether `required.value` names a {@link COLLECTION_LIST_LAYOUTS} member. The predicate narrows
 *  the passed object (a destructured parameter cannot carry a type predicate), so a caller that
 *  needs the narrowed layout holds the object in a variable and reads `.value` from it.
 *  @complexity O(1) */
export function isCollectionListLayout(required: { value: unknown }, _optional = {}): required is { value: CollectionListLayout } {
  return (COLLECTION_LIST_LAYOUTS as readonly unknown[]).includes(required.value);
}

/** The only structured-data block a collection list can opt into: schema.org `FAQPage`. */
export const COLLECTION_LIST_FAQ_PAGE = "faq-page";
export type CollectionListStructuredData = typeof COLLECTION_LIST_FAQ_PAGE;

/** Exclusion is applied before `limit` so system rows cannot crowd out visible entries. */
export type { EntryListExcludingTypesPort } from "../../widgets/resolvers/index.js";

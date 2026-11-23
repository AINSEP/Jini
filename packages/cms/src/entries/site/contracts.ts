/** Public entry read contracts and vocabulary; no repositories or registration wiring. */

/** Every collection-list presentation the host theme's entry-list renderer renders. `accordion` (an FAQ
 *  disclosure list) and `carousel` (a scroll-snap track of cards) were added for AW-7's zero-code
 *  Testimonials + FAQ plugin (2026-10-04). */
export const COLLECTION_LIST_LAYOUTS = ["cards", "list", "accordion", "carousel"] as const;
export type CollectionListLayout = (typeof COLLECTION_LIST_LAYOUTS)[number];

/** Whether `value` names a {@link COLLECTION_LIST_LAYOUTS} member. @complexity O(1) */
export function isCollectionListLayout(value: unknown): value is CollectionListLayout {
  return (COLLECTION_LIST_LAYOUTS as readonly unknown[]).includes(value);
}

/** The only structured-data block a collection list can opt into: schema.org `FAQPage`. */
export const COLLECTION_LIST_FAQ_PAGE = "faq-page";
export type CollectionListStructuredData = typeof COLLECTION_LIST_FAQ_PAGE;

/** Exclusion is applied before `limit` so system rows cannot crowd out visible entries. */
export type { EntryListExcludingTypesPort } from "../../widgets/resolvers/index.js";

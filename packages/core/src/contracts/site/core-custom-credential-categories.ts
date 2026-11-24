/**
 * @file Custom-credential category vocabulary. Types only; this module owns the declaration a host's
 * custom-credential category list used to declare. The host imports it from here and keeps its
 * runtime category list.
 */

/** The access-token page's own category-filter ids, minus `"all"` — mirrors the admin UI's
 *  access-token row category id exactly (that UI file is the source of truth for the UI's own copy;
 *  this is the server-side validation twin, since a category must be readable/filterable without
 *  ever decrypting a row — see the host's custom-credential-set `category` column doc). Kept as a
 *  plain literal union rather than importing from the admin app (server code never depends on the
 *  admin app). */
export type CustomCredentialCategoryId = "source-control" | "hosting" | "media" | "ai" | "ops" | "general";

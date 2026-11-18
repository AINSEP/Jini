/**
 * @file The bounds the site-wide SEO settings write validates against, as the single source for
 * a settings validator and a tool catalog that publishes them.
 */

// Exported (unchanged values) so `agent-tools.ts`'s published JSON Schema for `seo_set_settings`
// cannot drift from the bounds this chokepoint actually validates — same rationale as
// `write-service.ts`'s identical export note just above its own field-bound constants.
export const MAX_ROBOTS_RULES = 50;
export const MAX_RULE_PATH_ENTRIES = 100;
export const TITLE_TEMPLATE_MAX_LENGTH = 500;
export const DEFAULT_DESCRIPTION_MAX_LENGTH = 500;
export const DEFAULT_OG_IMAGE_MAX_LENGTH = 2048;
export const TWITTER_SITE_MAX_LENGTH = 100;

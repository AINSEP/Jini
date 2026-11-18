/**
 * @file Upper bounds of the numeric comment settings that a settings write may choose.
 *
 * Exported (not just module-local to the validator that enforces them) so an agent-tool catalog's
 * published `inputSchema` bounds import these single sources rather than restating the numbers:
 * the published JSON Schemas cannot drift from the validator that enforces them.
 */

/** The deepest reply nesting a settings write may allow. */
export const MAX_DEPTH_CEILING = 20;

/** The most submissions per address per hour a settings write may allow. */
export const MAX_PER_IP_PER_HOUR_CEILING = 1000;

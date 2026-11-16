/**
 * @file `EmbedPolicyPort` — which attributes an embedded HTML snippet may carry, injected by the host.
 *
 * The allow-list and parser belong to the content domain that renders embeds; admin only validates what an
 * operator types against it.
 */
import type { ParsedMediaHtmlAttributes } from '../../media/html-attributes.js';

export interface EmbedPolicyPort {
  readonly allowedAttributeNames: readonly string[];
  isAllowedAttributeName(required: { name: string }, optional?: Record<string, never>): boolean;
  parseAttributes(required: { text: string }, optional?: { styleContext?: 'stylesheet' }): ParsedMediaHtmlAttributes;
}

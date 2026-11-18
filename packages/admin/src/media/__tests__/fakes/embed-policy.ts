/**
 * @file Test doubles for `EmbedPolicyPort`. `realEmbedPolicy` binds the port to the content domain's own
 * allow-list and parser (what a host supplies), so the admin-side hint rules are checked against the rules
 * the server enforces; `denyAllEmbedPolicy` allows nothing, proving the injected port is the only authority.
 */
import {
  EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES,
  isAllowedEmbedHtmlAttributeName,
  parseEmbedHtmlAttributes,
} from '@jini-ai/cms/widgets/markers';
import type { EmbedPolicyPort } from '../../../core/ports/embed-policy.js';

export const realEmbedPolicy = {
  allowedAttributeNames: EMBED_HTML_ATTRIBUTE_ALLOWED_NAMES,
  isAllowedAttributeName: isAllowedEmbedHtmlAttributeName,
  parseAttributes: parseEmbedHtmlAttributes,
} satisfies EmbedPolicyPort;

export const denyAllEmbedPolicy: EmbedPolicyPort = {
  allowedAttributeNames: [],
  isAllowedAttributeName: () => false,
  parseAttributes: ({ text }) => {
    const error = { reason: 'disallowed-name', attribute: text.split('=')[0]!.trim() } as const;
    return { attributes: {}, errors: [error], error };
  },
};

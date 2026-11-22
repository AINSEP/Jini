import { describe, expect, it } from 'vitest';
import { isAllowedMediaHtmlAttributeName, parseMediaHtmlAttributes } from '../html-attributes.js';
import type { MediaHtmlAttributeRejectionReason } from '../html-attributes.js';
import { denyAllEmbedPolicy, realEmbedPolicy } from './fakes/embed-policy.js';

// Security class: the HTML-attribute allow-list. The admin hint must keep rejecting each class of input
// with the same reason the server parser gives, and the allow-list authority is the injected port alone.
const REJECTED = [
  ['formaction="/x"', 'disallowed-name', 'formaction'],
  ['onerror="alert(1)"', 'event-handler', 'onerror'],
  ['poster="javascript:alert(1)"', 'unsafe-url', 'poster'],
  ['style="behavior:url(x)"', 'unsafe-style', 'style'],
  ['loading="lazy" "', 'malformed', '"'],
] as const satisfies ReadonlyArray<readonly [string, MediaHtmlAttributeRejectionReason, string]>;

describe('media attribute hints under the real embed policy', () => {
  it.each(REJECTED)('rejects %s with reason %s naming %s', (text, reason, attribute) => {
    const parsed = parseMediaHtmlAttributes({ text, policy: realEmbedPolicy });
    expect(parsed.error).toEqual({ reason, attribute });
    expect(parsed.errors.at(-1)).toEqual({ reason, attribute });
  });
});

describe('the injected policy is the only authority', () => {
  it('asks the policy whether a name is allowed', () => {
    expect(isAllowedMediaHtmlAttributeName({ name: 'class', policy: realEmbedPolicy })).toBe(true);
    expect(isAllowedMediaHtmlAttributeName({ name: 'class', policy: denyAllEmbedPolicy })).toBe(false);
  });
  it('returns what the policy parsed, so a policy that allows nothing yields only rejections', () => {
    const parsed = parseMediaHtmlAttributes({ text: 'class="hero"', policy: denyAllEmbedPolicy });
    expect(parsed).toEqual({
      attributes: {},
      errors: [{ reason: 'disallowed-name', attribute: 'class' }],
      error: { reason: 'disallowed-name', attribute: 'class' },
    });
  });
  it('always parses as inline attributes: the stylesheet-context allowance is never requested', () => {
    const seen: unknown[] = [];
    const policy = {
      ...realEmbedPolicy,
      parseAttributes: (...args: Parameters<typeof realEmbedPolicy.parseAttributes>) => {
        seen.push(args);
        return realEmbedPolicy.parseAttributes(...args);
      },
    };
    parseMediaHtmlAttributes({ text: 'class="hero"', policy });
    expect(seen).toEqual([[{ text: 'class="hero"' }]]);
  });
});

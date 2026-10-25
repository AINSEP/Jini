import { describe, expect, it } from 'vitest';
import { gateConsentHtml } from '../html/index.js';
import { CONSENT_CLIENT } from '../html/client.js';
import { config } from './fixtures.js';

/**
 * `isRuntimeScript` (gate.ts) exempts exactly our runtime: a `<script>`, with this response's
 * runtime token, whose direct text is exactly CONSENT_CLIENT. Each case below breaks ONE conjunct
 * and must lose the exemption (the reserved marker is stripped, and a declared optional category
 * is templated). Stryker L4 found every conjunct mutable to `true` without a failing test.
 */

const transform = (body: string, options: object) => {
  const out = gateConsentHtml({ html: `<html><head></head><body>${body}</body></html>`, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  return out.slice(out.indexOf('</section>') + '</section>'.length, out.indexOf('</body>'));
};
const TOKEN = { runtimeToken: 'tok-1' };

describe('runtime-script exemption', () => {
  it('the exact runtime keeps its marker, even when it declares an optional category', () => {
    const runtime = `<script data-jini-consent-runtime="tok-1">${CONSENT_CLIENT}</script>`;
    expect(transform(runtime, TOKEN)).toBe(runtime);
    const categorised = `<script data-jini-consent-runtime="tok-1" data-consent-category="marketing">${CONSENT_CLIENT}</script>`;
    expect(transform(categorised, TOKEN)).toBe(categorised);
  });

  it.each([
    ['wrong token', `<script data-jini-consent-runtime="tok-2">${CONSENT_CLIENT}</script>`, TOKEN],
    ['token differs only by case', `<script data-jini-consent-runtime="TOK-1">${CONSENT_CLIENT}</script>`, TOKEN],
    ['text with a suffix', `<script data-jini-consent-runtime="tok-1">${CONSENT_CLIENT};steal()</script>`, TOKEN],
    ['text with a prefix', `<script data-jini-consent-runtime="tok-1">steal();${CONSENT_CLIENT}</script>`, TOKEN],
    ['no runtimeToken configured for this response', `<script data-jini-consent-runtime="tok-1">${CONSENT_CLIENT}</script>`, {}],
  ])('%s: the marker is stripped', (_label, body, options) => {
    const out = transform(body, options);
    expect(out).not.toContain('data-jini-consent-runtime');
  });

  it('a non-script element carrying the token and the runtime text is not exempt', () => {
    expect(transform(`<div data-jini-consent-runtime="tok-1">${CONSENT_CLIENT}</div>`, TOKEN)).not.toContain('data-jini-consent-runtime');
  });

  it.each([
    ['wrong token', 'tok-2', CONSENT_CLIENT],
    ['other text', 'tok-1', 'window.x=1'],
  ])('%s with an optional category is templated (gated), not exempt', (_label, token, text) => {
    const out = transform(`<script data-jini-consent-runtime="${token}" data-consent-category="analytics">${text}</script>`, TOKEN);
    expect(out.startsWith('<template data-jini-consent-script data-category="analytics">')).toBe(true);
    expect(out).not.toContain('data-jini-consent-runtime');
  });
});

describe('trusted-URL and necessary-script edges (coverage)', () => {
  const body = (html: string, options: object) => transform(html, options);
  it('an unparseable external URL is never trusted (gated), even with a page origin', () => {
    const out = body('<script src="https://[::1/x.js"></script>', { pageOrigin: 'https://site.example', resourceOrigins: ['https://site.example'] });
    expect(out).toContain('<template data-jini-consent-script');
  });
  it('a content-only necessary entry never exempts a script that has a src', () => {
    const out = body('<script src="https://tags.example/a.js"></script>', { necessaryScripts: [{ content: '' }] });
    expect(out).toContain('<template data-jini-consent-script');
  });
  it('a src necessary entry exempts exactly that external script', () => {
    const out = body('<script src="https://tags.example/a.js"></script><script src="https://tags.example/b.js"></script>', { necessaryScripts: [{ src: 'https://tags.example/a.js' }] });
    expect(out.startsWith('<script src="https://tags.example/a.js"></script>')).toBe(true);
    expect(out).toContain('<template data-jini-consent-script data-category="marketing"><script src="https://tags.example/b.js"></script></template>');
  });
});

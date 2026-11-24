/** siteConsentLinkProblem: the admin's pre-save explanation of why a policy link is refused.
 * withSiteConsentDefaultCss: the default banner style that fills an empty Custom CSS. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { compileConsentCss } from '../../render/index.js';
import { SITE_CONSENT_DEFAULT_CSS, SITE_CONSENT_DEFAULTS, siteConsentLinkProblem, withSiteConsentDefaultCss } from '../config.js';

const SITE_OR_HTTPS = 'Use a page on this site, like /privacy, or an https:// address.';

test('an empty link means "no link" and is acceptable', () => {
  assert.equal(siteConsentLinkProblem({ url: '' }), null);
});

test('a local path is accepted unless it carries spaces, control characters or backslashes', () => {
  assert.equal(siteConsentLinkProblem({ url: '/privacy' }), null);
  for (const url of ['/privacy policy', '/privacy\\x', '/privacy\tx', '/a\u0000b']) {
    assert.equal(siteConsentLinkProblem({ url }), 'Remove spaces and backslashes from the link.', url);
  }
});

test('a protocol-relative //host link is not a local path and must be a full https address', () => {
  assert.equal(siteConsentLinkProblem({ url: '//evil.example/privacy' }), SITE_OR_HTTPS);
});

test('an https URL without credentials is accepted; other schemes are refused', () => {
  assert.equal(siteConsentLinkProblem({ url: 'https://example.com/privacy' }), null);
  for (const url of ['http://example.com/privacy', 'javascript:alert(1)', 'mailto:privacy@example.com']) {
    assert.equal(siteConsentLinkProblem({ url }), SITE_OR_HTTPS, url);
  }
});

test('credentials embedded in an https URL are refused, user name or password alike', () => {
  const credentialed = ['https://user@example.com/privacy', `https://:${'p'.repeat(3)}@example.com/privacy`];
  for (const url of credentialed) assert.equal(siteConsentLinkProblem({ url }), 'Remove the user name or password from the link.', url);
});

test('text that is neither a local path nor a parseable URL gets the same fix sentence', () => {
  assert.equal(siteConsentLinkProblem({ url: 'privacy' }), SITE_OR_HTTPS);
});

test('the default banner CSS passes the engine policy unchanged and sets no colors, so the theme colors stay', () => {
  const { css, problems } = compileConsentCss({ css: SITE_CONSENT_DEFAULT_CSS, tokens: {} });
  assert.deepEqual(problems, []);
  assert.ok(css.includes('#jini-consent{padding:16px;border-radius:14px}'));
  assert.ok(css.includes('#jini-consent button{border-radius:8px}'));
  assert.ok(css.includes('#jini-consent a{border-radius:6px}'));
  assert.doesNotMatch(SITE_CONSENT_DEFAULT_CSS, /(^|[^-])color\s*:/m);
});

test('an unset or blank Custom CSS gets the default style; the owner\'s own CSS is never replaced', () => {
  for (const customCss of [undefined, '', '  \n']) {
    assert.equal(withSiteConsentDefaultCss({ config: { title: 'T', customCss } }).customCss, SITE_CONSENT_DEFAULT_CSS, JSON.stringify(customCss));
  }
  const own = { title: 'T', customCss: '#jini-consent { padding: 12px; }' };
  assert.equal(withSiteConsentDefaultCss({ config: own }), own);
  const comment = { customCss: '/* plain engine look */' };
  assert.equal(withSiteConsentDefaultCss({ config: comment }), comment);
});

test('new sites default to a corner card, not a full-width bar', () => {
  assert.equal(SITE_CONSENT_DEFAULTS.placement, 'bottom-right');
});

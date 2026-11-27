/** @file The site-config → cookie-consent converter: old saved configs render unchanged, banner modes,
 * the strict-region rule and owner CSS reaching the banner. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SITE_CONSENT_DEFAULT_CSS, SITE_CONSENT_DEFAULTS } from '../config.js';
import { renderSiteConsentPreview, siteBannerMode, toSiteCookieConsent, type SiteConsentSource } from '../cookie-consent.js';

// A saved config from an owner who turned the banner on; the product default is off (2026-11-02).
const saved: SiteConsentSource = { ...SITE_CONSENT_DEFAULTS, enabled: true, privacyPolicyUrl: '/privacy', customCss: SITE_CONSENT_DEFAULT_CSS };

test('an old saved config (no bannerMode) keeps every copy field and shows the Jini banner', () => {
  const { banner, options } = toSiteCookieConsent({ config: saved, policy: '1:rev1' });
  assert.equal(banner.mode, 'jini');
  assert.deepEqual(banner.client, { contract: 1, policy: '1:rev1', regionMode: 'auto' });
  for (const key of ['title', 'message', 'acceptLabel', 'rejectLabel', 'preferencesLabel', 'privacyPolicyUrl'] as const) assert.equal(banner.copy[key], saved[key]);
  assert.deepEqual(options, { reopen: 'link', placement: 'bottom-right', customCss: SITE_CONSENT_DEFAULT_CSS });
});

test('banner mode: the on/off switch rules, then the saved mode, then the Jini banner', () => {
  assert.equal(siteBannerMode({ config: { enabled: false, bannerMode: 'jini' } }), 'off');
  assert.equal(siteBannerMode({ config: { enabled: true, bannerMode: 'headless' } }), 'headless');
  assert.equal(siteBannerMode({ config: { enabled: true, bannerMode: 'off' } }), 'off');
  assert.equal(siteBannerMode({ config: { enabled: true } }), 'jini');
});

test('a global opt-out is read as auto, so unknown visitors keep Reject; opt-in stays opt-in', () => {
  assert.equal(toSiteCookieConsent({ config: { ...saved, regionMode: 'opt-out' }, policy: 'p' }).banner.client.regionMode, 'auto');
  assert.equal(toSiteCookieConsent({ config: { ...saved, regionMode: 'opt-in' }, policy: 'p' }).banner.client.regionMode, 'opt-in');
});

test('the secondary link needs both label and URL; an unknown placement falls back to the package default', () => {
  const half = toSiteCookieConsent({ config: { ...saved, secondaryLinkLabel: 'Terms', secondaryLinkUrl: '' }, policy: 'p' });
  assert.equal(half.banner.copy.secondaryLinkLabel, undefined);
  const both = toSiteCookieConsent({ config: { ...saved, secondaryLinkLabel: 'Terms', secondaryLinkUrl: '/terms', placement: 'middle' }, policy: 'p' });
  assert.equal(both.banner.copy.secondaryLinkUrl, '/terms');
  assert.equal(both.options.placement, undefined);
});

test('plugins reach the client config only when there are some; preferences reopen through a link', () => {
  const adapter = { id: 'x', kind: 'consent-adapter', category: 'analytics', src: '/_consent/p/x/a.mjs' };
  assert.deepEqual(toSiteCookieConsent({ config: saved, policy: 'p' }, { plugins: [adapter] }).banner.client.plugins, [adapter]);
  assert.equal('plugins' in toSiteCookieConsent({ config: saved, policy: 'p' }, { plugins: [] }).banner.client, false);
  assert.equal(toSiteCookieConsent({ config: saved, policy: 'p' }).options.reopen, 'link');
});

test('owner CSS reaches the preview; a bad rule is dropped alone (paired with the same CSS without it)', () => {
  const good = '#jini-consent h2 { font-size: 16px; }';
  const base = renderSiteConsentPreview({ config: { ...saved, customCss: good }, policy: 'p' });
  const withBad = renderSiteConsentPreview({ config: { ...saved, customCss: `${good}\n#jini-consent [data-x] { color: #000000; }` }, policy: 'p' });
  assert.match(base.head, /#jini-consent h2/);
  assert.match(withBad.head, /#jini-consent h2/);
  assert.equal(base.problems.length, 0);
  assert.equal(withBad.problems.length, 1);
  assert.equal(withBad.problems[0]!.code, 'selector');
});

test('the preview of "None" still shows the Jini banner, scriptless, for the asked region', () => {
  const preview = renderSiteConsentPreview({ config: { ...saved, enabled: false }, policy: 'p' }, { region: 'opt-out' });
  assert.match(preview.body, /id="jini-consent"/);
  assert.match(preview.htmlAttrs, /data-consent-region="opt-out"/);
  assert.doesNotMatch(preview.head, /<script src=/);
});

test('uses appearance tokens without changing banner mode or inventing missing CSS', () => {
  const { customCss: _missing, ...config } = saved;
  const appearance = { borderRadius: '11px' };
  const { banner, options } = toSiteCookieConsent({ config: { ...config, appearance, bannerMode: 'headless' }, policy: 'published:19' });
  assert.equal(banner.mode, 'headless');
  assert.equal(banner.client.policy, 'published:19');
  assert.deepEqual(options, { reopen: 'link', placement: 'bottom-right', appearance });
});

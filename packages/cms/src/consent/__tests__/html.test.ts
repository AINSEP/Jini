import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import { gateConsentHtml, renderConsentUi, renderConsentHead, consentPolicyHref } from '../html/index.js';
import { CONSENT_CLIENT } from '../html/client.js';
import { stripConsentRuntime } from '../html/static.js';
import { CONSENT_CSS } from '../html/styles.js';
import { resolveConsentRegion } from '../policy.js';
import { MENU_DROPDOWN_SCRIPT } from '../../navigation/dropdown.js';
import { LISTING_SEE_MORE_SCRIPT } from '../../listing/see-more-script.js';
import { accepted, config } from './fixtures.js';

// Real installed browser emulator, loaded without adding a types dependency to the no-DOM core.
const { JSDOM, ResourceLoader, CookieJar, VirtualConsole } = createRequire(import.meta.url)('jsdom');
const page = '<!doctype html><html><head><link rel="preload" as="script" href="https://tags.example/track.js"><link rel="modulepreload" href="/module.js"><link rel="preconnect" href="https://tags.example"><style>p{color:red}</style><script data-consent-category="necessary">window.runs=[];window.runs.push("necessary")</script></head><body><p>Site</p><script data-consent-category="analytics" src="https://tags.example/track.js"></script><script data-consent-category="analytics">window.runs.push("inline-analytics")</script><script data-consent-category="functional">window.runs.push("functional")</script><script data-consent-category="typo">window.runs.push("invalid")</script><script type="application/ld+json">{"@type":"Site"}</script><template><script>window.runs.push("authored-template")</script></template></body></html>';
const necessaryScripts = [{ content: 'window.runs=[];window.runs.push("necessary")' }];
const gate = (record = null as typeof accepted | null, gpc = false) => gateConsentHtml({ html: page, config, record, gpc, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { necessaryScripts });

type FetchStub = (url: string, options: { body: { toString(): string } }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
async function browser(html: string, browserGpc = false, { cookieJar, fetch }: { cookieJar?: unknown; fetch?: FetchStub } = {}) {
  const requests: string[] = [];
  class Loader extends ResourceLoader {
    fetch(url: string) { requests.push(url); return Promise.resolve(Buffer.from('window.runs.push("external-analytics");')); }
  }
  // jsdom cannot navigate; location.reload() reports "not implemented" to this console only.
  const virtualConsole = new VirtualConsole();
  const runtimeErrors: unknown[] = [];
  const reloads: unknown[] = [];
  virtualConsole.on('jsdomError', (error: Error) => {
    if (error.message.startsWith('Not implemented: navigation')) reloads.push(error);
    else runtimeErrors.push(error);
  });
  const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'dangerously', resources: new Loader(), virtualConsole, ...(cookieJar ? { cookieJar } : {}), beforeParse(window: { navigator: object; fetch?: FetchStub }) { Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: browserGpc }); if (fetch) window.fetch = fetch; } });
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  await new Promise<void>(resolve => setImmediate(resolve));
  return { dom, requests, runtimeErrors, reloads };
}

describe('region-based first consent screen', () => {
  it.each([
    ['auto', 'US', 'opt-out'], ['auto', 'US-CA', 'opt-out'], ['auto', ' us-tx ', 'opt-out'],
    ['auto', 'DE', 'opt-in'], ['auto', 'GB', 'opt-in'], ['auto', 'CH', 'opt-in'],
    ['auto', null, 'opt-in'], ['auto', '', 'opt-in'], ['auto', 'unknown', 'opt-in'],
    ['opt-in', 'US-CA', 'opt-in'], ['opt-out', 'DE', 'opt-out'],
  ] as const)('renders %s policy in region %s as %s without JavaScript', (configuredMode, region, expectedMode) => {
    const regionMode = resolveConsentRegion({ configuredMode, region });
    expect(regionMode).toBe(expectedMode);
    const dom = new JSDOM(renderConsentUi({ config: { ...config, regionMode: configuredMode }, record: null, regionMode, gpc: false, endpoint: '/api/site-consent' }));
    try {
      const document = dom.window.document;
      const actions = [...document.querySelectorAll('.jini-consent-initial button')];
      expect(actions.map((button: HTMLButtonElement) => button.textContent)).toEqual(expectedMode === 'opt-out' ? ['Accept all'] : ['Reject non-essential', 'Accept all']);
      for (const button of actions) { expect(button.disabled).toBe(false); expect(button.tabIndex).toBe(0); }
      const preferences = document.querySelector('#jini-consent-preferences');
      expect(preferences.open).toBe(false);
      expect(preferences.querySelector('summary').textContent).toBe('Cookie preferences');
      expect(preferences.querySelector('summary').tabIndex).toBe(0);
      // The existing submit control looks like a link and works without a JavaScript click bridge.
      const noSale = document.querySelector('[data-jini-do-not-sell-button]');
      expect(noSale.closest('details')).toBeNull();
      expect(noSale.hidden).toBe(false); expect(noSale.disabled).toBe(false); expect(noSale.tabIndex).toBe(0);
      expect(noSale.type).toBe('submit'); expect(noSale.name).toBe('action'); expect(noSale.value).toBe('do-not-sell');
      expect(noSale.form.getAttribute('method')).toBe('post');
      if (expectedMode === 'opt-out') expect(noSale.textContent).toBe('Do not sell or share my info');
    } finally { dom.window.close(); }
  });

  it.each(['save', 'do-not-sell'] as const)('uses the existing %s action to opt out from the first screen', async action => {
    const submissions: string[] = [];
    const choices = { necessary: true, functional: true, analytics: false, marketing: false };
    const html = gateConsentHtml({ html: page, config, record: null, regionMode: 'opt-out', gpc: false, endpoint: '/api/site-consent' }, { necessaryScripts });
    const { dom, runtimeErrors, reloads } = await browser(html, false, { fetch: async (_url, options) => {
      submissions.push(options.body.toString());
      return { ok: true, json: async () => ({ record: { ...accepted, regionMode: 'opt-out', action, choices }, signals: { analytics_storage: 'denied', ad_storage: 'denied' } }) };
    } });
    try {
      const document = dom.window.document;
      expect(document.querySelector('.jini-consent-initial button[value="reject"]')).toBeNull();
      if (action === 'save') {
        document.querySelector('#jini-consent-preferences summary').click();
        expect(document.querySelector('#jini-consent-preferences').open).toBe(true);
        for (const category of ['analytics', 'marketing']) {
          const input = document.querySelector(`[name="${category}"]`);
          expect(input.checked).toBe(true); expect(input.disabled).toBe(false);
          input.click();
        }
      }
      document.querySelector(`button[value="${action}"]`).click();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(submissions).toEqual([action === 'save' ? 'policyVersion=1&gpc=0&functional=on&action=save' : 'policyVersion=1&gpc=0&functional=on&analytics=on&marketing=on&action=do-not-sell']);
      expect(document.querySelector('[name="analytics"]').checked).toBe(false);
      expect(document.querySelector('[name="marketing"]').checked).toBe(false);
      expect(runtimeErrors).toEqual([]); expect(reloads).toHaveLength(1);
    } finally { dom.window.close(); }
  });
});

describe('delivered HTML consent boundary', () => {
  it('leaves disabled HTML byte-identical and safely gates every optional/unknown script', () => {
    expect(gateConsentHtml({ html: page, config: { ...config, enabled: false }, record: null, gpc: false, regionMode: 'opt-out', endpoint: '/api/site-consent' })).toBe(page);
    const html = gate();
    expect(html).not.toContain('rel="preload"'); expect(html).toContain('<link rel="modulepreload" href="/module.js">'); expect(html).not.toContain('rel="preconnect"');
    expect(html).toContain('<template data-jini-consent-script data-category="analytics"><script data-consent-category="analytics" src="https://tags.example/track.js">');
    expect(html).toContain('data-category="blocked"');
    expect(html).toContain('<style>p{color:red}</style>');
    expect(html).toContain('<script type="application/ld+json">{"@type":"Site"}</script>');
    expect(html.indexOf('data-jini-consent-runtime')).toBeLessThan(html.indexOf('data-consent-category="necessary"'));
    expect(html.indexOf('id="jini-consent"')).toBeLessThan(html.indexOf('<p>Site</p>'));
  });
  it('makes zero optional resource requests before an opt-in choice', async () => {
    const { dom, requests } = await browser(gateConsentHtml({ html: page, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { necessaryScripts }));
    try {
      expect(requests).toEqual([]); expect(Array.from(dom.window.runs)).toEqual(['necessary']);
      expect(Array.from(dom.window.dataLayer[0])).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted' }]);
      expect(dom.window.document.querySelector('[name=analytics]').checked).toBe(false);
    } finally { dom.window.close(); }
  });
  it('releases saved grants once in order after the default/update signals; invalid/authored templates remain inert', async () => {
    const { dom, requests } = await browser(gate(accepted));
    try {
      expect(requests).toEqual(['https://tags.example/track.js']);
      expect(Array.from(dom.window.runs)).toEqual(['necessary', 'external-analytics', 'inline-analytics', 'functional']);
      expect(dom.window.dataLayer[0][1]).toBe('default'); expect(dom.window.dataLayer[1][1]).toBe('update');
      expect(dom.window.dataLayer[1][2].ad_user_data).toBe('granted');
    } finally { dom.window.close(); }
  });
  it('honors navigator GPC even if the request header missed it and submits the sole no-sale button', async () => {
    const { dom, requests, runtimeErrors, reloads } = await browser(gate(accepted), true);
    const submissions: unknown[] = [];
    dom.window.fetch = async (url: string, options: { body: { toString(): string } }) => {
      submissions.push({ url, body: options.body.toString() });
      return { ok: true, json: async () => ({ record: { ...accepted, action: 'do-not-sell', choices: { necessary: true, functional: true, analytics: false, marketing: false } }, signals: { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' } }) };
    };
    try {
      expect(requests).toEqual([]); expect(Array.from(dom.window.runs)).toEqual(['necessary', 'functional']);
      expect(dom.window.document.querySelector('[name=marketing]').disabled).toBe(true);
      expect(dom.window.document.querySelector('[name=analytics]').checked).toBe(false);
      expect(dom.window.dataLayer[1][2].ad_personalization).toBe('denied');
      dom.window.document.querySelector('.jini-consent-manage').open = true;
      const button = dom.window.document.querySelector('[data-jini-do-not-sell-button]');
      button.click();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(submissions).toEqual([{ url: 'https://site.example/api/site-consent', body: 'policyVersion=1&gpc=1&functional=on&action=do-not-sell' }]);
      expect(dom.window.dataLayer.at(-1)[2].ad_storage).toBe('denied');
      expect(runtimeErrors).toEqual([]);
      expect(reloads).toHaveLength(1);
    } finally { dom.window.close(); }
  });
  it.each([
    ['reject', '/api/site-consent', 'https://site.example/api/site-consent', { necessary: true, functional: false, analytics: false, marketing: false }],
    ['accept', 'https://site.example/api/site-consent', 'https://site.example/api/site-consent', accepted.choices],
    ['save', 'site-consent', 'https://site.example/settings/site-consent', { necessary: true, functional: true, analytics: true, marketing: false }],
    ['do-not-sell', '../api/site-consent', 'https://site.example/api/site-consent', { necessary: true, functional: true, analytics: false, marketing: false }],
  ] as const)('saves %s to the action attribute despite named buttons and reflects the saved choices', async (action, endpoint, expectedUrl, choices) => {
    const html = `<!doctype html><html><head><base href="https://site.example/settings/">${renderConsentHead({ config, record: accepted, gpc: false })}</head><body>${renderConsentUi({ config, record: accepted, regionMode: 'opt-in', gpc: false, endpoint })}</body></html>`;
    const submissions: unknown[] = [];
    const signals = { ad_storage: choices.marketing ? 'granted' : 'denied', analytics_storage: choices.analytics ? 'granted' : 'denied' };
    const { dom, runtimeErrors, reloads } = await browser(html, false, { fetch: async (url, options) => {
      submissions.push({ url, action: new URLSearchParams(options.body.toString()).get('action') });
      return { ok: true, json: async () => ({ record: { ...accepted, action, choices }, signals }) };
    } });
    try {
      const form = dom.window.document.querySelector('#jini-consent form');
      const actions = form.elements.namedItem('action');
      expect(actions).toBeInstanceOf(dom.window.RadioNodeList);
      expect(actions.length).toBe(5);
      // jsdom lacks HTMLFormElement's named getter; model Chrome's lookup with the real controls.
      Object.defineProperty(form, 'action', { configurable: true, value: actions });
      expect(form.action).toBe(actions);
      if (action === 'save') form.querySelector('[name=marketing]').checked = false;
      form.querySelector(`button[name=action][value="${action}"]`).click();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(submissions).toEqual([{ url: expectedUrl, action }]);
      expect(Array.from(dom.window.dataLayer.at(-1))).toEqual(['consent', 'update', signals]);
      for (const category of ['functional', 'analytics', 'marketing'] as const) {
        expect(form.querySelector(`[name=${category}]`).checked).toBe(choices[category]);
      }
      expect(form.querySelector('[data-jini-consent-error]').hidden).toBe(true);
      expect(runtimeErrors).toEqual([]);
      expect(reloads).toHaveLength(1);
    } finally { dom.window.close(); }
  });
  it('a failed enhanced save displays the server error and never releases optional code', async () => {
    const { dom, requests } = await browser(gate());
    const submissions: unknown[] = [];
    dom.window.fetch = async (url: string, options: { body: { toString(): string } }) => {
      submissions.push({ url, body: options.body.toString() });
      return { ok: false, json: async () => ({ error: 'Cookie preferences could not be saved. Your previous choices still apply. Please try again.' }) };
    };
    try {
      const form = dom.window.document.querySelector('#jini-consent form');
      const button = form.querySelector('button[value=accept]');
      form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(submissions).toEqual([{ url: 'https://site.example/api/site-consent', body: 'policyVersion=1&gpc=0&action=accept' }]);
      expect(dom.window.document.querySelector('[data-jini-consent-error]').textContent).toBe('Cookie preferences could not be saved. Your previous choices still apply. Please try again.');
      expect(dom.window.document.cookie).toBe('');
      expect(button.disabled).toBe(false); expect(requests).toEqual([]); expect(Array.from(dom.window.runs)).toEqual(['necessary']);
      expect(dom.window.dataLayer.length).toBe(1);
    } finally { dom.window.close(); }
  });
  it('a static host without the consent endpoint shows the plain save error and keeps optional code inert', async () => {
    const { dom, requests } = await browser(gate());
    dom.window.fetch = async () => ({ ok: false, status: 405, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
    try {
      const button = dom.window.document.querySelector('#jini-consent form button[value=accept]');
      button.closest('form').dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(dom.window.document.querySelector('[data-jini-consent-error]').textContent).toBe('Cookie preferences could not be saved.');
      expect(button.disabled).toBe(false); expect(requests).toEqual([]); expect(Array.from(dom.window.runs)).toEqual(['necessary']);
    } finally { dom.window.close(); }
  });
  it('escapes configurable text and keeps a native no-JS rejection path; unsafe policy URLs are omitted', () => {
    const html = renderConsentUi({ config: { ...config, title: '<script>alert(1)</script>', privacyPolicyUrl: 'javascript:alert(1)' }, record: null, regionMode: 'opt-in', gpc: true, endpoint: '/api/site-consent' });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('javascript:');
    expect(html).toContain('method="post" action="/api/site-consent"'); expect(html).toContain('name="action" value="reject"');
    expect(html).toContain('name="necessary" checked disabled'); expect(html).toContain('name="analytics" disabled');
    for (const url of ['//evil.example', '/\\evil.example', '/privacy\n', 'data:text/html,x', 'http://site.example/privacy']) expect(consentPolicyHref({ url })).toBeNull();
    expect(consentPolicyHref({ url: '/privacy' })).toBe('/privacy');
    expect(consentPolicyHref({ url: 'https://site.example/privacy' })).toBe('https://site.example/privacy');
  });
  it('preserves a leading doctype with implicit head markup and removes foreign-namespace scripts', () => {
    const html = gateConsentHtml({ html: '<!doctype html><html><body><link rel="preload" as="fetch" href="https://tags.example/hidden.js"><svg><script data-consent-category="analytics">window.tracked=true</script></svg></body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
    expect(html.startsWith('<!doctype html><html>')).toBe(true);
    expect(html).not.toContain('window.tracked=true');
    expect(html).not.toContain('<svg><template');
    expect(html).not.toContain('https://tags.example/hidden.js');
  });
});


describe('consent security regressions', () => {
  const transform = (html: string, record: typeof accepted | null = null, options = {}) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  it('page runtime markers and self-declared necessity cannot exempt external scripts', async () => {
    const html = transform('<html><head></head><body><div data-jini-consent-runtime></div><script data-jini-consent-runtime="forged" data-consent-category="necessary" src="https://tags.example/forged.js"></script><script src="https://tags.example/neighbor.js"></script></body></html>', null, { runtimeToken: 'host-response-token' });
    const { dom } = await browser(html);
    try { expect(dom.window.leaked).toBeUndefined(); expect(dom.window.neighbor).toBeUndefined(); expect(dom.window.document.querySelectorAll('template[data-jini-consent-script]').length).toBe(2); }
    finally { dom.window.close(); }
  });
  it('explicit optional labels override even exact host manifest entries', async () => {
    const content = 'window.essential=true';
    const { dom } = await browser(transform(`<html><head></head><body><script>${content}</script><script src="/rogue.js" data-consent-category="analytics"></script></body></html>`, null, { necessaryScripts: [{ content }, { src: "/rogue.js" }] }));
    try { expect(dom.window.essential).toBe(true); expect(dom.window.document.querySelector('script[src="/rogue.js"]')).toBeNull(); }
    finally { dom.window.close(); }
  });
  it('a functional-only grant cannot release untagged third-party tags', async () => {
    const { dom, requests } = await browser(transform('<html><head></head><body><script src="https://tags.example/untagged.js"></script></body></html>', { ...accepted, choices: { necessary: true, functional: true, analytics: false, marketing: false } }));
    try { expect(requests).toEqual([]); expect(dom.window.document.querySelector('template').dataset.category).toBe('marketing'); }
    finally { dom.window.close(); }
  });
  it('blocks remote resources and noscript pixels while preserving noscript and UI handlers', () => {
    const html = transform('<html><head><link rel="prerender" href="https://tags.example"><link rel="stylesheet" href="https://tags.example/site.css"><style>@font-face{src:url(https://tags.example/font.woff)}</style></head><body onload="window.leaked=true"><iframe srcdoc="&lt;img src=https://tags.example/pixel&gt;"></iframe><img src="https://tags.example/pixel"><img src="/photo.png" srcset="/photo.png 1x, https://tags.example/pixel 2x"><video poster="https://tags.example/pixel" src="/movie.mp4"></video><embed src="https://tags.example/pixel"><object data="https://tags.example/pixel"></object><noscript><img src="https://tags.example/nojs"></noscript><button onclick="window.leaked=true" style="background:url(https://tags.example/pixel)">Click</button></body></html>');
    for (const enabled of [false, true]) {
      const dom = new JSDOM(html, { runScripts: enabled ? 'dangerously' : undefined });
      try {
        const document = dom.window.document;
        expect(document.querySelectorAll('iframe,img,video,embed,object,link[rel=stylesheet]').length).toBe(0);
        expect(document.querySelector('link[rel=prerender]')).toBeNull();
        expect(document.querySelector('style:not([data-jini-consent-style])')).toBeNull();
        expect(document.querySelectorAll('[onclick],[onload]').length).toBe(2);
        expect(document.querySelector('button[style]')).toBeNull();
        expect(document.querySelector('noscript')).not.toBeNull();
        expect(document.querySelectorAll('template[data-jini-consent-resource]').length).toBe(enabled ? 8 : 9);
      } finally { dom.window.close(); }
    }
  });
  it('replays late theme DOMContentLoaded listeners once without replaying essential listeners', async () => {
    const essential = 'window.early=0;document.addEventListener("DOMContentLoaded",function(){window.early++})';
    const { dom } = await browser(transform(`<html><head><script>${essential}</script></head><body><script data-consent-category="functional">document.addEventListener("DOMContentLoaded",function(){window.themeReady=(window.themeReady||0)+1},{once:true})</script></body></html>`, accepted, { necessaryScripts: [{ content: essential }] }));
    try { expect(dom.window.themeReady).toBe(1); expect(dom.window.early).toBe(1); }
    finally { dom.window.close(); }
  });
  it('opt-out defaults still honor navigator GPC and persistent rejection', async () => {
    const html = gateConsentHtml({ html: page, config, record: null, gpc: false, regionMode: 'opt-out', endpoint: '/api/site-consent' }, { necessaryScripts });
    const yes = await browser(html), gpc = await browser(html, true);
    try {
      expect(yes.requests).toEqual(['https://tags.example/track.js']); expect(gpc.requests).toEqual([]); expect(yes.dom.window.dataLayer[1][2].ad_storage).toBe('granted');
      for (const category of ['analytics', 'marketing']) {
        const input = gpc.dom.window.document.querySelector(`[name="${category}"]`);
        expect(input.checked).toBe(false); expect(input.disabled).toBe(true);
      }
      expect(gpc.dom.window.document.querySelector('.jini-consent-initial button[value="reject"]')).toBeNull();
    }
    finally { yes.dom.window.close(); gpc.dom.window.close(); }
  });
  it('static HTML retains denied templates without a broken endpoint, banner or runtime', () => {
    const html = stripConsentRuntime({ html: transform(page) });
    expect(html).not.toContain('action="/api/site-consent"'); expect(html).not.toContain('id="jini-consent"'); expect(html).not.toContain(CONSENT_CLIENT);
    expect(html).not.toContain('data-jini-consent-style'); expect(html).not.toContain('id="jini-consent-config"'); expect(html).not.toContain('data-jini-consent-runtime');
    expect(html).toContain('<p>Site</p>'); expect(html).toContain('<template data-jini-consent-script');
  });
  it('keeps inert data and template scripts as data rather than turning them executable', () => {
    const html = transform('<html><head></head><body><script type="text/x-template"><div>Template</div></script><script type="importmap">{"imports":{}}</script></body></html>');
    const dom = new JSDOM(html);
    try { expect(dom.window.document.querySelector('script[type="text/x-template"]').textContent).toBe('<div>Template</div>'); expect(dom.window.document.querySelector('script[type=importmap]').textContent).toBe('{"imports":{}}'); }
    finally { dom.window.close(); }
  });
});


it('normalizes ignored template closing tags inside optional subtrees so they cannot expose pixels', () => {
  const html = gateConsentHtml({ html: '<html><body><object data="https://tags.example/embedded"><p>Fallback</p></template><img src="https://tags.example/escape"></object></body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const dom = new JSDOM(html);
  try { expect(dom.window.document.querySelector('img')).toBeNull(); expect(dom.window.document.querySelector('object')).toBeNull(); }
  finally { dom.window.close(); }
});
it('keeps functional chat controls inert until their loader category is granted', async () => {
  const html = '<html><head></head><body><button id="chat" data-consent-category="functional">Chat</button></body></html>';
  const denied = await browser(gateConsentHtml({ html, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }));
  const granted = await browser(gateConsentHtml({ html, config, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }));
  try { expect(denied.dom.window.document.getElementById('chat')).toBeNull(); expect(granted.dom.window.document.getElementById('chat').textContent).toBe('Chat'); }
  finally { denied.dom.window.close(); granted.dom.window.close(); }
});


it('never promotes authored release templates into executable content, even with a functional grant', async () => {
  const record = { ...accepted, choices: { necessary: true, functional: true, analytics: false, marketing: false } };
  const html = gateConsentHtml({ html: '<html><body><template data-jini-consent-script data-category="functional"><script src="https://tags.example/spoof.js"></script></template></body></html>', config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const { dom, requests } = await browser(html);
  try { expect(requests).toEqual([]); expect(dom.window.document.querySelector('script[src]')).toBeNull(); }
  finally { dom.window.close(); }
});


it('classifies browser-normalized protocol-relative tag URLs as marketing', () => {
  const html = gateConsentHtml({ html: String.raw`<html><body><script src="/\tags.example/tracker.js"></script></body></html>`, config, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const dom = new JSDOM(html);
  try { expect(dom.window.document.querySelector('template[data-jini-consent-script]').dataset.category).toBe('marketing'); }
  finally { dom.window.close(); }
});


it('emits browser policy before local CSS to block hidden remote CSS/font imports until marketing is allowed', async () => {
  const html = gateConsentHtml({ html: '<html><head><link rel="stylesheet" href="/local.css"></head><body>Page</body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const policy = "script-src 'self' 'unsafe-inline'; object-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; connect-src 'self'";
  expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('href="/local.css"'));
  for (const markup of [html, stripConsentRuntime({ html })]) {
    const dom = new JSDOM(markup);
    try { expect(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe(policy); }
    finally { dom.window.close(); }
  }
  const saved = gateConsentHtml({ html: '<html><head></head><body>Page</body></html>', config, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const { dom } = await browser(saved, true);
  try { expect(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe(policy); }
  finally { dom.window.close(); }
});


it.each(['text/x-javascript', 'application/x-javascript', 'text/jscript', 'text/livescript', ...Array.from({ length: 6 }, (_, n) => `text/javascript1.${n}`), 'application/x-ecmascript', 'text/x-ecmascript', 'text/javascript; charset=utf-8', 'speculationrules', 'future-executable-type'])('denies explicitly optional script type %s until consent', async type => {
  const html = gateConsentHtml({ html: `<html><body><script data-consent-category="analytics" type="${type}">window.mimeLeak=true</script></body></html>`, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const { dom } = await browser(html);
  try {
    expect(dom.window.mimeLeak).toBeUndefined();
    expect(dom.window.document.querySelector(`script[type="${type}"]`)).toBeNull();
    expect(dom.window.document.querySelector('template[data-jini-consent-script]').content.querySelector('script').type).toBe(type);
  } finally { dom.window.close(); }
});
it('denies background attributes, SVG feImage and bare-string CSS image-set without removing page structure', () => {
  const html = gateConsentHtml({ html: `<html><head><style>p{background:image-set("https://tags.example/pixel" 1x)}</style></head><body background="https://tags.example/bg"><table background="https://tags.example/table"><tr><td>Page</td></tr></table><svg><feImage href="https://tags.example/svg" /></svg><p style='background:-webkit-image-set("https://tags.example/css" 1x)'>Text</p></body></html>`, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const dom = new JSDOM(html);
  try {
    expect(dom.window.document.body.hasAttribute('background')).toBe(false);
    expect(dom.window.document.querySelector('feImage')).toBeNull();
    expect(dom.window.document.querySelector('table')).toBeNull();
    expect(dom.window.document.querySelector('p[style]')).toBeNull();
    expect(dom.window.document.querySelector('style:not([data-jini-consent-style])')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('Text');
    const policy = dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    expect(policy).toContain("img-src 'self' data: blob:");
    for (const directive of ['media-src', 'frame-src', 'connect-src']) expect(policy).toContain(`${directive} 'self'`);
  } finally { dom.window.close(); }
});

it('uses only host-reviewed theme origins in the resource policy, including browser-only GPC', async () => {
  const html = gateConsentHtml({ html: '<html><body>Page</body></html>', config, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { resourceOrigins: ['https://theme.example'] });
  const { dom } = await browser(html, true);
  try {
    expect(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe("script-src 'self' https://theme.example 'unsafe-inline'; object-src 'none'; style-src 'self' https://theme.example 'unsafe-inline'; font-src 'self' https://theme.example data:; img-src 'self' https://theme.example data: blob:; media-src 'self' https://theme.example; frame-src 'self' https://theme.example; connect-src 'self' https://theme.example");
  } finally { dom.window.close(); }
  expect(() => gateConsentHtml({ html: '<html><body>Page</body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { resourceOrigins: ["https://theme.example/"] })).toThrow('Consent resource origin "https://theme.example/" must be an exact HTTP(S) origin such as https://cdn.example (no path or trailing slash).');
});

it('preserves local SVG references and ordinary navigation while gating remote resources', () => {
  const html = gateConsentHtml({ html: '<html><body><svg><use href="#icon"></use></svg><a href="https://elsewhere.example/">Visit</a><form action="https://elsewhere.example/"></form></body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const dom = new JSDOM(html);
  try {
    expect(dom.window.document.querySelector('use').getAttribute('href')).toBe('#icon');
    expect(dom.window.document.querySelector('a[href="https://elsewhere.example/"]').textContent).toBe('Visit');
    expect(dom.window.document.querySelector('form[action="https://elsewhere.example/"]')).not.toBeNull();
  } finally { dom.window.close(); }
});

it('keeps legacy frames inert before a visitor choice', () => {
  const html = gateConsentHtml({ html: '<html><head></head><frameset><frame src="https://tags.example/frame"></frameset></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const dom = new JSDOM(html);
  try { expect(dom.window.document.querySelector('frame')).toBeNull(); }
  finally { dom.window.close(); }
});

describe('gate boundaries', () => {
  const transform = (html: string, options = {}) => gateConsentHtml({ html, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  it('keeps only the exact host runtime for this response; a matching token cannot exempt explicitly optional code', () => {
    const runtime = `<script data-jini-consent-runtime="host-token">${CONSENT_CLIENT}</script>`;
    const html = transform(`<html><head></head><body>${runtime}<script data-jini-consent-runtime="host-token" data-consent-category="functional">window.other=true</script></body></html>`, { runtimeToken: 'host-token' });
    expect(html).toContain(`</section>${runtime}<template data-jini-consent-script data-category="functional"><script data-consent-category="functional">window.other=true</script></template></body>`);
  });
  it('removes base and meta refresh but keeps other meta elements and rel-less links', () => {
    const html = transform('<html><head><base href="https://tags.example/"><meta charset="utf-8"><meta http-equiv="Refresh" content="0;url=https://tags.example/"><meta http-equiv="content-type" content="text/html"><link href="/local.css"></head><body></body></html>');
    expect(html).not.toContain('<base'); expect(html).toContain('<link href="/local.css">');
    expect(html).toContain('<meta charset="utf-8">'); expect(html).toContain('<meta http-equiv="content-type" content="text/html">');
    expect(html).not.toContain('Refresh');
  });
  it('gates local tracking-pixel images by size or declared category, keeping ordinary local images', () => {
    const html = transform('<html><body><img src="/a.png" width="1"><img src="/b.png" height="1"><input type="image" src="/c.png" data-consent-category="analytics"><img src="/photo.png"></body></html>');
    expect(html).toContain('</section><template data-jini-consent-resource data-category="marketing"><img src="/a.png" width="1"></template><template data-jini-consent-resource data-category="marketing"><img src="/b.png" height="1"></template><template data-jini-consent-resource data-category="analytics"><input type="image" src="/c.png" data-consent-category="analytics"></template><img src="/photo.png"></body>');
  });
  it('matches host manifest scripts by exact src', () => {
    const html = transform('<html><body><script src="https://sdk.example/essential.js"></script><script src="https://sdk.example/other.js"></script></body></html>', { necessaryScripts: [{ src: 'https://sdk.example/essential.js' }] });
    expect(html).toContain('<body><section'); expect(html).toContain('</section><script src="https://sdk.example/essential.js"></script><template data-jini-consent-script data-category="marketing"><script src="https://sdk.example/other.js"></script></template>');
  });
  it('bootstraps after the doctype, or at offset 0, when the page has no html or head tags; the UI lands first at the shared offset', () => {
    const head = renderConsentHead({ record: null, gpc: false, regionMode: 'opt-in' });
    const doctype = transform('<!doctype html><p>Page</p>');
    expect(doctype.startsWith('<!doctype html><section id="jini-consent"')).toBe(true); expect(doctype.endsWith(`</section>${head}<p>Page</p>`)).toBe(true);
    const bare = transform('<p>Page</p>');
    expect(bare.startsWith('<section id="jini-consent"')).toBe(true); expect(bare.endsWith(`</section>${head}<p>Page</p>`)).toBe(true);
  });
});

describe('repeated html/body start tags (the parser merges their attributes into the first element)', () => {
  const transform = (html: string, record: typeof accepted | null = null) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
  const roots = (dom: InstanceType<typeof JSDOM>) => [dom.window.document.documentElement, dom.window.document.body] as Array<{ getAttributeNames(): string[] }>;
  it.each([
    ['a second body tag', '<html><body><p>x</p><body onload="window.leaked=true" data-jini-consent-runtime="x"></body></html>'],
    ['a second body tag with several handlers', '<html><body><p>x</p><body onpageshow="window.leaked=true" onclick="window.leaked=true" ONRESIZE="window.leaked=true"></body></html>'],
    ['a second body tag repeating a handler the first already has', '<html><body onload="window.first=true"><p>x</p><body onload="window.leaked=true"></body></html>'],
    ['an implied body followed by an explicit one', '<p>x</p><body onload="window.leaked=true">'],
    ['a second html tag', '<html><body><p>x</p><html onclick="window.leaked=true" id="jini-consent-config"></body></html>'],
    ['a body tag foster-parented out of a table', '<html><body><p>x</p><table><body onpageshow="window.leaked=true"></table></body></html>'],
  ])('defers handlers and strips markers merged from %s', async (_name, page) => {
    const html = transform(page.replace(/<(html|body)\b/g, '<$1 data-consent-category="functional"'));
    const { dom } = await browser(html);
    try {
      const names = roots(dom).flatMap(element => element.getAttributeNames());
      expect(names.filter(name => /^on/i.test(name) || name === 'data-jini-consent-runtime' || name === 'id')).toEqual([]);
      expect(dom.window.leaked).toBeUndefined(); expect(dom.window.first).toBeUndefined();
      expect(dom.window.document.getElementById('jini-consent-config').tagName).toBe('SCRIPT');
      expect(dom.window.document.body.textContent).toContain('x');
      expect(html).toContain('data-jini-consent-attributes=');
    } finally { dom.window.close(); }
  });
  it('a merged handler is restored by the release payload once its category is granted', async () => {
    const { dom } = await browser(transform('<html><body><p>x</p><body onclick="window.clicked=true"></body></html>', accepted));
    try { expect(dom.window.document.body.getAttribute('onclick')).toBe('window.clicked=true'); }
    finally { dom.window.close(); }
  });
  it('leaves documents without repeated root tags byte-for-byte outside the gated edits', () => {
    const page = "<!doctype html><html lang='en'><body class=x><p title='a'>x</p></body></html>";
    expect(transform(page)).toContain("<html lang='en'>"); expect(transform(page)).toContain("<p title='a'>x</p>");
  });
  it('defers foreign-content attributes whose parsed name differs from the source spelling', () => {
    const dom = new JSDOM(transform('<html><body><svg><a xlink:href="javascript:window.leaked=true"><text>x</text></a></svg></body></html>'));
    try { expect(dom.window.document.querySelector('svg a').getAttributeNames()).not.toContain('xlink:href'); }
    finally { dom.window.close(); }
  });
});

describe('first-party presentation and category-specific resource policy', () => {
  const transform = (html: string, record: typeof accepted | null = null, options = {}) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  const policyOf = (html: string) => {
    const dom = new JSDOM(html);
    try { return dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null; }
    finally { dom.window.close(); }
  };
  it.each([
    ['local background and font urls', '.hero{background:url(/img/hero.jpg)}@font-face{font-family:x;src:url("/fonts/a.woff2") format("woff2"),url(\'fonts/a.woff\')}'],
    ['relative image-set and local import', '.a{background:image-set("a.png" 1x, url(b.png) 2x)}@import "/theme/print.css";'],
    ['data urls', '.i{background:url(data:image/svg+xml;utf8,<svg></svg>)}'],
    ['escaped quote characters', 'q::before{content:"\\201C"}'],
  ])('keeps a style element with %s ungated', (_name, css) => {
    const html = transform(`<html><head><style>${css}</style></head><body></body></html>`);
    expect(html).toContain(`<style>${css}</style>`); expect(html).not.toContain('<template data-jini-consent-resource');
  });
  it('keeps local style attribute images', () => {
    expect(transform(`<html><body><div style="background-image:url('img/bg.png')">x</div></body></html>`)).toContain(`<div style="background-image:url('img/bg.png')">x</div>`);
  });
  it.each([
    ['a remote url', '.a{background:url(https://tags.example/p.png)}'],
    ['a protocol-relative url', '.a{background:url( "//tags.example/p.png" )}'],
    ['an escaped url function', '.a{background:\\75 rl(https://tags.example/p.png)}'],
    ['an escaped scheme', '.a{background:url(htt\\70s://tags.example/p.png)}'],
    ['a remote string after a local url in image-set', '.a{background:image-set(url(/a.png) 1x, "https://tags.example/b.png" 2x)}'],
    ['a remote import', '@import "https://tags.example/a.css";'],
    ['an unterminated url', '.a{background:url(/a.png'],
  ])('still gates a style element with %s', (_name, css) => {
    expect(transform(`<html><head><style>${css}</style></head><body></body></html>`)).toContain('<template data-jini-consent-resource data-category="marketing"><style>');
  });
  it('an analytics grant allows only host-reviewed analytics origins; marketing removes the policy', () => {
    const categoryOrigins = { analytics: ['https://collect.example'], functional: ['https://chat.example'] };
    const page = '<html><head></head><body>Page</body></html>';
    const analytics = policyOf(transform(page, { ...accepted, choices: { necessary: true, functional: false, analytics: true, marketing: false } }, { categoryOrigins }));
    expect(analytics).toBe("script-src 'self' https://collect.example 'unsafe-inline'; object-src 'none'; style-src 'self' https://collect.example 'unsafe-inline'; font-src 'self' https://collect.example data:; img-src 'self' https://collect.example data: blob:; media-src 'self' https://collect.example; frame-src 'self' https://collect.example; connect-src 'self' https://collect.example");
    expect(policyOf(transform(page, null, { categoryOrigins }))).not.toContain('example');
    expect(policyOf(transform(page, accepted, { categoryOrigins }))).toBeNull();
  });
  it('browser-only GPC applies the policy of its own reduced choices', async () => {
    const categoryOrigins = { analytics: ['https://collect.example'], functional: ['https://chat.example'] };
    const { dom } = await browser(transform('<html><head></head><body>Page</body></html>', accepted, { categoryOrigins }), true);
    try {
      const policy = dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
      expect(policy).toContain("connect-src 'self' https://chat.example"); expect(policy).not.toContain('collect.example');
    } finally { dom.window.close(); }
  });
  it('names an invalid category origin and how to fix it', () => {
    expect(() => transform('<html><body></body></html>', null, { categoryOrigins: { analytics: ['https://collect.example/path'] } })).toThrow('Consent resource origin "https://collect.example/path" must be an exact HTTP(S) origin such as https://cdn.example (no path or trailing slash).');
  });
});

describe('withdrawal when the save fails', () => {
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted' };
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));
  async function rejectWith(response: Awaited<ReturnType<FetchStub>> | Error) {
    const cookieJar = new CookieJar();
    const { dom } = await browser(gate(accepted), false, { cookieJar, fetch: async () => { if (response instanceof Error) throw response; return response; } });
    expect(Array.from(dom.window.runs)).toEqual(['necessary', 'external-analytics', 'inline-analytics', 'functional']);
    const form = dom.window.document.querySelector('#jini-consent form');
    form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button[value=reject]') }));
    await settle();
    return { dom, cookieJar };
  }
  it('denies at once, keeps denying on the next page and retries the save there', async () => {
    const { dom, cookieJar } = await rejectWith(new TypeError('Failed to fetch'));
    try {
      expect(Array.from(dom.window.dataLayer.at(-1))).toEqual(['consent', 'update', denied]);
      expect(dom.window.document.querySelector('[data-jini-consent-error]').textContent).toBe('Your choice applies on this device now, but it could not be saved yet. It will be saved automatically on a later page.');
      expect(dom.window.document.cookie).toContain('jini_consent_withdrawal=');
    } finally { dom.window.close(); }
    const posted: string[] = [];
    const next = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => { posted.push(options.body.toString()); return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }; } });
    try {
      await settle();
      expect(next.requests).toEqual([]); expect(Array.from(next.dom.window.runs)).toEqual(['necessary']);
      expect(Array.from(next.dom.window.dataLayer[1])).toEqual(['consent', 'update', denied]);
      expect(Array.from(next.dom.window.document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).length).toBe(1);
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=reject']);
      expect(next.dom.window.document.querySelector('[data-jini-consent-error]').hidden).toBe(false);
      expect(next.dom.window.document.cookie).toContain('jini_consent_withdrawal=');
    } finally { next.dom.window.close(); }
    const saved = await browser(gate(accepted), false, { cookieJar, fetch: async () => ({ ok: true, status: 200, json: async () => ({ record: { ...accepted, action: 'reject', choices: { necessary: true, functional: false, analytics: false, marketing: false } }, signals: denied }) }) });
    try {
      await settle();
      expect(Array.from(saved.dom.window.runs)).toEqual(['necessary']);
      expect(saved.dom.window.document.cookie).toBe('');
      expect(saved.dom.window.document.querySelector('[data-jini-consent-error]').hidden).toBe(true);
    } finally { saved.dom.window.close(); }
  });
  it('a refused withdrawal still applies locally but is not retried', async () => {
    const { dom, cookieJar } = await rejectWith({ ok: false, status: 400, json: async () => ({ error: 'The privacy policy changed. Reload this page and choose again.' }) });
    try { expect(dom.window.document.querySelector('[data-jini-consent-error]').textContent).toBe('Your choice applies on this device now, but it could not be saved. Choose again to save it.'); }
    finally { dom.window.close(); }
    const posted: string[] = [];
    const next = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => { posted.push(options.body.toString()); return { ok: true, json: async () => ({}) }; } });
    try { await settle(); expect(posted).toEqual([]); expect(Array.from(next.dom.window.runs)).toEqual(['necessary']); }
    finally { next.dom.window.close(); }
  });
  it('an unsaved partial withdrawal keeps only the categories both choices allow', async () => {
    const cookieJar = new CookieJar();
    const { dom } = await browser(gate(accepted), false, { cookieJar, fetch: async () => { throw new TypeError('offline'); } });
    try {
      const form = dom.window.document.querySelector('#jini-consent form');
      form.querySelector('[name=marketing]').checked = false;
      form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button[value=save]') }));
      await settle();
    } finally { dom.window.close(); }
    const next = await browser(gate(accepted), false, { cookieJar });
    try {
      await settle();
      expect(Array.from(next.dom.window.runs)).toEqual(['necessary', 'external-analytics', 'inline-analytics', 'functional']);
      expect(next.dom.window.dataLayer[1][2].ad_storage).toBe('denied'); expect(next.dom.window.dataLayer[1][2].analytics_storage).toBe('granted');
    } finally { next.dom.window.close(); }
  });
});

describe('after a choice the banner collapses to a settings control', () => {
  const ui = (record: typeof accepted | null) => renderConsentUi({ config: { ...config, preferencesLabel: 'Cookie settings' }, record, regionMode: 'opt-in', gpc: false, endpoint: '/api/site-consent' });
  it('renders a closed disclosure whose summary reopens the preferences, only once a choice exists', async () => {
    expect(ui(null)).not.toContain('jini-consent-manage');
    const { dom } = await browser(gateConsentHtml({ html: '<html><body><p>Site</p></body></html>', config: { ...config, preferencesLabel: 'Cookie settings' }, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }));
    try {
      const banner = dom.window.document.getElementById('jini-consent');
      const manage = banner.firstElementChild;
      expect(manage.matches('details.jini-consent-manage')).toBe(true); expect(manage.open).toBe(false);
      expect(manage.querySelector(':scope > summary').textContent).toBe('Cookie settings');
      expect(manage.querySelector('#jini-consent-preferences').open).toBe(true);
      expect(manage.querySelector('form button[value=save]')).not.toBeNull();
    } finally { dom.window.close(); }
  });
  it('keeps the saved control fixed without overriding the configured placement', () => {
    expect(CONSENT_CSS).not.toContain('position:static');
    expect(CONSENT_CSS).not.toMatch(/\.jini-consent\[data-has-record="true"\]\{[^}]*inset:/);
  });
  it.each([
    ['bottom-right', 'auto 1rem 1rem auto'], ['bottom-left', 'auto auto 1rem 1rem'],
    ['bottom-bar', 'auto 1rem 1rem'], ['top-bar', '1rem 1rem auto'],
  ])('uses the same %s position for first-visit and reopened panels', (placement, inset) => {
    for (const reopen of ['link', 'corner'] as const) {
      const documents = [null, accepted].map(record => new JSDOM(gateConsentHtml({ html: '<html><head></head><body></body></html>', config: { ...config, placement: placement as NonNullable<typeof config.placement>, reopen }, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }), { url: 'https://site.example/#jini-consent' }));
      try {
        for (const dom of documents) {
          const banner = dom.window.document.getElementById('jini-consent');
          expect(banner.dataset.placement).toBe(placement);
          expect(dom.window.getComputedStyle(banner).position).toBe('fixed');
          expect(dom.window.getComputedStyle(banner).inset).toBe(inset);
        }
      } finally { for (const dom of documents) dom.window.close(); }
    }
  });
});


describe('review regressions: ambiguous HTML and URL normalization', () => {
  const transform = (html: string, record: typeof accepted | null = null, options = {}) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  it.each(['onerror', 'ONERROR', 'OnError'])('keeps only the browser-retained first duplicate %s UI handler', async duplicate => {
    const html = transform(`<html><body><img id="probe" src="/bad" onerror="window.leaked=1" ${duplicate}="window.leaked=2"></body></html>`);
    const { dom, runtimeErrors } = await browser(html);
    try {
      const image = dom.window.document.getElementById('probe');
      expect(image.hasAttribute('onerror')).toBe(true);
      image.dispatchEvent(new dom.window.Event('error'));
      expect(dom.window.leaked).toBe(1);
      expect(image.dataset.jiniConsentAttributes).toBeUndefined();
      expect(runtimeErrors).toEqual([]);
    } finally { dom.window.close(); }
  });
  it('keeps the browser-retained first duplicate handler when its category is granted', async () => {
    const { dom, runtimeErrors } = await browser(transform('<html><body><img id="probe" src="/bad" onerror="window.leaked=1" ONERROR="window.leaked=2"></body></html>', accepted));
    try {
      dom.window.document.getElementById('probe').dispatchEvent(new dom.window.Event('error'));
      expect(dom.window.leaked).toBe(1); expect(runtimeErrors).toEqual([]);
    } finally { dom.window.close(); }
  });
  it.each(['java&#x09;script:', 'java&#x0a;script:', 'java&#13;script:', 'java\tscript:', 'java\rscript:', 'java\nscript:'])('defers browser-normalized JavaScript URLs in all navigation attributes: %s', scheme => {
    const html = transform(`<html><body><a id="link" href="${scheme}window.leaked=1">Open</a><form id="form" action="${scheme}window.leaked=1"><button id="button" formaction="${scheme}window.leaked=1">Go</button></form></body></html>`);
    const dom = new JSDOM(html);
    try {
      for (const [id, attribute] of [['link', 'href'], ['form', 'action'], ['button', 'formaction']] as const) {
        const element = dom.window.document.getElementById(id);
        expect(element.hasAttribute(attribute)).toBe(false);
        const deferred = JSON.parse(element.dataset.jiniConsentAttributes)[attribute];
        expect(new URL(deferred, 'https://site.example').protocol).toBe('javascript:');
      }
    } finally { dom.window.close(); }
  });
  it.each(['https://*', 'https://*.example.com'])('rejects wildcard CSP hosts in both origin options: %s', origin => {
    const html = '<html><head></head><body>Page</body></html>';
    expect(() => transform(html, null, { resourceOrigins: [origin] })).toThrow('must be an exact HTTP(S) origin');
    expect(() => transform(html, null, { categoryOrigins: { analytics: [origin] } })).toThrow('must be an exact HTTP(S) origin');
    expect(() => transform(html, null, { categoryOrigins: { functional: [origin] } })).toThrow('must be an exact HTTP(S) origin');
  });
  // parse5 implements the WHATWG doctype-to-mode table; jsdom's compatMode reports CSS1Compat for
  // any doctype, so it cannot observe this regression.
  it.each([
    ['quirks', '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">'],
    ['limited-quirks', '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">'],
  ])('preserves %s document mode and exact public/system identifiers during root normalization', (mode, doctype) => {
    const original = `${doctype}<html><head></head><body><body><p>x</p></body></html>`;
    const html = transform(original);
    expect(parse(original).mode).toBe(mode); expect(parse(html).mode).toBe(mode);
    expect(html.startsWith(doctype)).toBe(true);
  });
  it.each([
    '@import/*;*/"https://tracker.example/a.css";',
    '@import "https://tracker.example/a;b.css";',
    '@import/**/url("https://tracker.example/a;b.css");',
    '@import /* unterminated',
    '@import "/local.css',
  ])('gates remote or unreadable CSS imports across comment/string token boundaries: %s', css => {
    const html = transform(`<html><head><style>${css}</style></head><body></body></html>`);
    const dom = new JSDOM(html);
    try {
      expect(dom.window.document.querySelector('style:not([data-jini-consent-style])')).toBeNull();
      expect(dom.window.document.querySelector('template[data-jini-consent-resource]').content.querySelector('style').textContent).toBe(css);
    } finally { dom.window.close(); }
  });
  it('keeps readable local CSS imports with semicolons inside strings and comments', () => {
    const css = '@import/*;*/"/theme/a;b.css";';
    const dom = new JSDOM(transform(`<html><head><style>${css}</style></head><body></body></html>`));
    try {
      expect(dom.window.document.querySelector('style:not([data-jini-consent-style])').textContent).toBe(css);
      expect(dom.window.document.querySelector('template[data-jini-consent-resource]')).toBeNull();
    } finally { dom.window.close(); }
  });
});


describe('review regressions: withdrawal reconciliation', () => {
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));
  const deniedChoices = { necessary: true, functional: false, analytics: false, marketing: false };
  const deniedRecord = { ...accepted, action: 'save' as const, choices: deniedChoices };
  const reply = (record = deniedRecord) => ({ ok: true, status: 200, json: async () => ({ record, signals: { security_storage: 'granted', ad_storage: 'denied' } }) });
  function marker(cookieJar: InstanceType<typeof CookieJar>, values: Record<string, string>, name = '__Host-jini_consent_withdrawal') {
    const value = encodeURIComponent(new URLSearchParams(values).toString());
    cookieJar.setCookieSync(`${name}=${value}; Path=/; Secure`, 'https://site.example/');
  }
  function submit(dom: InstanceType<typeof JSDOM>, action: string) {
    const form = dom.window.document.querySelector('#jini-consent form');
    form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector(`button[value=${action}]`) }));
  }
  it('restores floating UI from a failed first choice marker while preserving native preferences reopening', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '0', analytics: '0', marketing: '0' });
    const html = gateConsentHtml({ html: page, config: { ...config, reopen: 'link' }, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { necessaryScripts });
    const result = await browser(html, false, { cookieJar });
    try {
      expect(result.runtimeErrors).toEqual([]);
      expect(result.dom.window.jiniConsent).toEqual({ hasChoice: true, analytics: false, gpc: false });
      expect(result.dom.window.document.documentElement.classList.contains('jini-consent-has-choice')).toBe(true);
      expect(result.dom.window.document.querySelector('#jini-consent').dataset.hasRecord).toBe('true');
      expect(result.dom.window.getComputedStyle(result.dom.window.document.documentElement).getPropertyValue('--jini-floating-ui-display')).toBe('');
      result.dom.window.location.hash = '#jini-consent';
      expect(result.dom.window.document.documentElement.matches(':has(#jini-consent[data-reopen="link"]:target)')).toBe(true);
    } finally { result.dom.window.close(); }
  });
  it('preserves a legacy parent-domain withdrawal as denial on HTTPS without posting its forged acceptance', async () => {
    const cookieJar = new CookieJar();
    const value = encodeURIComponent(new URLSearchParams({ functional: '0', analytics: '0', marketing: '0', body: 'policyVersion=1&gpc=0&action=accept' }).toString());
    cookieJar.setCookieSync(`jini_consent_withdrawal=${value}; Domain=site.example; Path=/; Secure`, 'https://evil.site.example/');
    const posted: string[] = [];
    const result = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => { posted.push(options.body.toString()); return reply(); } });
    try {
      await settle();
      expect(posted).toEqual([]); expect(result.reloads).toEqual([]); expect(result.runtimeErrors).toEqual([]);
      expect(result.dom.window.document.cookie).toContain('__Host-jini_consent_withdrawal=');
      expect(result.dom.window.document.querySelector('#jini-consent [name=marketing]').checked).toBe(false);
      expect(Array.from(result.dom.window.runs)).toEqual(['necessary']);
    } finally { result.dom.window.close(); }
  });
  it('derives automatic saves from the effective intersection and ignores a serialized grant body', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '0', analytics: '1', marketing: '1', retry: '1', body: 'policyVersion=1&gpc=0&action=accept' });
    const record = { ...accepted, choices: { necessary: true, functional: true, analytics: false, marketing: false } };
    const posted: string[] = [];
    const result = await browser(gate(record), false, { cookieJar, fetch: async (_url, options) => { posted.push(options.body.toString()); return reply(); } });
    try {
      await settle();
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=reject']);
      expect(result.dom.window.document.cookie).toBe('');
      expect(result.reloads).toEqual([]); expect(result.runtimeErrors).toEqual([]);
      expect(Array.from(result.dom.window.runs)).toEqual(['necessary']);
    } finally { result.dom.window.close(); }
  });
  it('retries a partial withdrawal as a saved selection of the remaining grants', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '1', analytics: '1', marketing: '0', retry: '1' });
    const saved = { ...accepted, action: 'save' as const, choices: { necessary: true, functional: true, analytics: true, marketing: false } };
    const posted: string[] = [];
    const result = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => { posted.push(options.body.toString()); return reply(saved); } });
    try {
      await settle();
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=save&functional=on&analytics=on']);
      expect(result.dom.window.document.cookie).toBe('');
      expect(result.reloads).toEqual([]); expect(result.runtimeErrors).toEqual([]);
    } finally { result.dom.window.close(); }
  });
  it('keeps denial without another retry or reload when reconciliation returns extra grants', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '0', analytics: '0', marketing: '0', retry: '1' });
    const posted: string[] = [];
    const fetch: FetchStub = async (_url, options) => { posted.push(options.body.toString()); return { ok: true, json: async () => ({ record: accepted }) }; };
    const first = await browser(gate(accepted), false, { cookieJar, fetch });
    try {
      await settle(); expect(posted).toEqual(['policyVersion=1&gpc=0&action=reject']);
      expect(first.reloads).toEqual([]); expect(first.runtimeErrors).toEqual([]);
      expect(Array.from(first.dom.window.runs)).toEqual(['necessary']);
      const cookies = cookieJar.getCookiesSync('https://site.example/');
      expect(cookies).toHaveLength(1); expect(cookies[0].key).toBe('__Host-jini_consent_withdrawal');
      expect(cookies[0].hostOnly).toBe(true); expect(cookies[0].secure).toBe(true); expect(cookies[0].path).toBe('/');
      expect(new URLSearchParams(decodeURIComponent(cookies[0].value)).has('retry')).toBe(false);
    } finally { first.dom.window.close(); }
    const next = await browser(gate(accepted), false, { cookieJar, fetch });
    try {
      await settle(); expect(posted).toHaveLength(1); expect(next.reloads).toEqual([]); expect(next.runtimeErrors).toEqual([]);
      expect(Array.from(next.dom.window.runs)).toEqual(['necessary']);
    } finally { next.dom.window.close(); }
  });
  it('lets a durable explicit choice shadow a surviving legacy domain marker without another automatic save', async () => {
    const cookieJar = new CookieJar();
    const value = encodeURIComponent('functional=0&analytics=0&marketing=0&body=action%3Daccept');
    cookieJar.setCookieSync(`jini_consent_withdrawal=${value}; Domain=site.example; Path=/; Secure`, 'https://evil.site.example/');
    const posted: string[] = [];
    const fetch: FetchStub = async (_url, options) => { posted.push(options.body.toString()); return { ok: true, json: async () => ({ record: accepted, signals: {} }) }; };
    const first = await browser(gate(accepted), false, { cookieJar, fetch });
    try {
      submit(first.dom, 'accept'); await settle();
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=accept']);
      expect(first.reloads).toHaveLength(1); expect(first.runtimeErrors).toEqual([]);
    } finally { first.dom.window.close(); }
    const next = await browser(gate(accepted), false, { cookieJar, fetch });
    try {
      await settle(); expect(posted).toHaveLength(1); expect(next.reloads).toEqual([]); expect(next.runtimeErrors).toEqual([]);
      expect(Array.from(next.dom.window.runs)).toEqual(['necessary', 'external-analytics', 'inline-analytics', 'functional']);
    } finally { next.dom.window.close(); }
  });
  it('serializes an explicit submission behind an in-flight denial reconciliation', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '0', analytics: '0', marketing: '0', retry: '1' });
    let finishRetry!: (value: Awaited<ReturnType<FetchStub>>) => void;
    const pending = new Promise<Awaited<ReturnType<FetchStub>>>(resolve => { finishRetry = resolve; });
    const posted: string[] = [];
    const result = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => {
      posted.push(options.body.toString());
      return posted.length === 1 ? pending : { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) };
    } });
    try {
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=reject']);
      submit(result.dom, 'accept'); await settle();
      expect(posted).toHaveLength(1);
      finishRetry(reply()); await settle();
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=reject', 'policyVersion=1&gpc=0&action=accept']);
      expect(result.runtimeErrors).toEqual([]); expect(result.reloads).toEqual([]);
      expect(result.dom.window.document.cookie).toBe('');
    } finally { result.dom.window.close(); }
  });
  it('initializes preferences from effective withdrawal choices so Save cannot accidentally regrant', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '0', analytics: '0', marketing: '0' });
    const posted: string[] = [];
    const result = await browser(gate(accepted), false, { cookieJar, fetch: async (_url, options) => {
      posted.push(options.body.toString()); return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) };
    } });
    try {
      for (const name of ['functional', 'analytics', 'marketing']) expect(result.dom.window.document.querySelector(`#jini-consent [name=${name}]`).checked).toBe(false);
      submit(result.dom, 'save'); await settle();
      expect(posted).toEqual(['policyVersion=1&gpc=0&action=save']);
      expect(Array.from(result.dom.window.runs)).toEqual(['necessary']); expect(result.runtimeErrors).toEqual([]);
    } finally { result.dom.window.close(); }
  });
  it('synchronizes preferences with further denials returned by reconciliation', async () => {
    const cookieJar = new CookieJar();
    marker(cookieJar, { functional: '1', analytics: '1', marketing: '0', retry: '1' });
    const result = await browser(gate(accepted), false, { cookieJar, fetch: async () => reply() });
    try {
      await settle();
      for (const name of ['functional', 'analytics', 'marketing']) expect(result.dom.window.document.querySelector(`#jini-consent [name=${name}]`).checked).toBe(false);
      expect(result.dom.window.dataLayer.at(-1)[2].ad_storage).toBe('denied'); expect(result.runtimeErrors).toEqual([]);
    } finally { result.dom.window.close(); }
  });
});

describe('first-party site behavior without optional consent', () => {
  const rejected = { ...accepted, action: 'reject' as const, choices: { necessary: true as const, functional: false, analytics: false, marketing: false } };
  const transform = (html: string, record: typeof accepted | null) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });

  it.each([null, rejected])('runs unlabelled inline and local source scripts and keeps UI handlers: %j', async record => {
    // The loader records actual requests and returns executable script bytes. jsdom does not
    // enforce CSP; the CSP contract is asserted separately below.
    const html = '<html><head><script>window.runs=["inline"]</script></head><body><script src="/theme-assets/preview/scripts/ui.js"></script><button id="ui" onclick="window.clicked=true">Open</button></body></html>';
    const { dom, requests, runtimeErrors } = await browser(transform(html, record));
    try {
      expect(requests).toEqual(['https://site.example/theme-assets/preview/scripts/ui.js']);
      expect(Array.from(dom.window.runs)).toEqual(['inline', 'external-analytics']);
      dom.window.document.getElementById('ui').click();
      expect(dom.window.clicked).toBe(true); expect(runtimeErrors).toEqual([]);
      expect(dom.window.document.querySelector('template[data-jini-consent-script]')).toBeNull();
    } finally { dom.window.close(); }
  });

  it.each([null, rejected])('keeps local media and no-JS fallback while gating external resources: %j', record => {
    const html = '<html><head></head><body><video id="video" src="/movie.mp4"><source src="media/movie.webm"><track src="/captions.vtt"></video><audio id="audio" src="audio.ogg"></audio><noscript><p>Local fallback</p><img src="/fallback.png"><img src="https://tags.example/nojs"></noscript><script src="https://tags.example/sdk.js"></script><iframe src="/embedded"></iframe><img src="https://tags.example/pixel"><img width="1" src="/pixel"></body></html>';
    const dom = new JSDOM(transform(html, record));
    try {
      const document = dom.window.document;
      for (const selector of ['#video', '#audio', 'video source', 'video track', 'noscript p', 'noscript img[src="/fallback.png"]']) expect(document.querySelector(selector)).not.toBeNull();
      expect(document.querySelector('template noscript')).toBeNull();
      expect(document.querySelector('noscript template').content.querySelector('img').src).toBe('https://tags.example/nojs');
      expect(document.querySelector('iframe')).toBeNull();
      expect(document.querySelector('script[src]')).toBeNull();
      expect(document.querySelector('img[src="https://tags.example/pixel"]')).toBeNull();
      expect(document.querySelector('img[src="/pixel"]')).toBeNull();
      expect(document.querySelectorAll('template[data-jini-consent-resource]')).toHaveLength(4);
    } finally { dom.window.close(); }
  });

  it('preserves noscript while applying its optional label to local fallback resources', () => {
    const dom = new JSDOM(transform('<html><head></head><body><noscript data-consent-category="analytics"><img src="/optional.png"></noscript></body></html>', rejected));
    try {
      const fallback = dom.window.document.querySelector('noscript');
      expect(fallback).not.toBeNull(); expect(fallback.querySelector('img')).toBeNull();
      expect(fallback.querySelector('template').dataset.category).toBe('analytics');
    } finally { dom.window.close(); }
  });

  it('applies an optional document-root label to its own handlers without templating the page', () => {
    const dom = new JSDOM(transform('<html><head></head><body data-consent-category="analytics" onload="track()"><p id="content">Site</p><img src="/local.png"></body></html>', rejected));
    try {
      const document = dom.window.document;
      expect(document.body.hasAttribute('onload')).toBe(false);
      expect(document.body.dataset.jiniConsentCategory).toBe('analytics');
      expect(document.getElementById('content')).not.toBeNull(); expect(document.querySelector('img')).not.toBeNull();
    } finally { dom.window.close(); }
  });

  it('conservatively gates absolute sources when the gate has no site origin', () => {
    const dom = new JSDOM(transform('<html><head></head><body><script src="https://site.example/ui.js"></script></body></html>', rejected));
    try {
      expect(dom.window.document.querySelector('script[src]')).toBeNull();
      expect(dom.window.document.querySelector('template[data-jini-consent-script]').dataset.category).toBe('marketing');
    } finally { dom.window.close(); }
  });

  it('keeps unlabelled inline speculation rules gated like the removed resource hints', () => {
    const dom = new JSDOM(transform('<html><head></head><body><script type="speculationrules">{"prefetch":[{"urls":["https://tags.example/next"]}]}</script></body></html>', rejected));
    try {
      expect(dom.window.document.querySelector('script[type="speculationrules"]')).toBeNull();
      expect(dom.window.document.querySelector('template[data-jini-consent-script]').content.querySelector('script').type).toBe('speculationrules');
    } finally { dom.window.close(); }
  });

  it('does not inherit a necessary document-root label onto first-party descendants', () => {
    const dom = new JSDOM(transform('<html data-consent-category="necessary"><head></head><body><p id="content">Site</p><img src="/local.png"><script>window.ran=true</script></body></html>', rejected));
    try {
      const document = dom.window.document;
      expect(document.getElementById('content')).not.toBeNull();
      expect(document.querySelector('img[src="/local.png"]')).not.toBeNull();
      expect(document.querySelector('template[data-jini-consent-resource], template[data-jini-consent-script]')).toBeNull();
    } finally { dom.window.close(); }
  });

  it.each(['functional', 'analytics', 'marketing'])('keeps explicitly %s inline/local scripts, handlers and media gated after rejection', async category => {
    const html = `<html><head></head><body><script data-consent-category="${category}">window.optional=true</script><script data-consent-category="${category}" src="/optional.js"></script><button id="optional" data-consent-category="${category}" onclick="window.clicked=true">Optional</button><video data-consent-category="${category}" src="/optional.mp4"></video></body></html>`;
    const { dom, requests } = await browser(transform(html, rejected));
    try {
      expect(dom.window.optional).toBeUndefined(); expect(requests).toEqual([]);
      expect(dom.window.document.querySelector('#optional')).toBeNull();
      expect(dom.window.document.querySelector('video')).toBeNull();
      expect(dom.window.document.querySelectorAll(`template[data-category="${category}"]`)).toHaveLength(4);
    } finally { dom.window.close(); }
  });
});

describe('per-site dynamic code exception', () => {
  const baseline = "script-src 'self' 'unsafe-inline'; object-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; connect-src 'self'";

  it.each([undefined, false, 'true', 1, {}])('keeps the policy byte-identical unless the flag is literally true (%j)', allowUnsafeEval => {
    const supplied = allowUnsafeEval === undefined ? config : { ...config, allowUnsafeEval: allowUnsafeEval as boolean };
    const html = renderConsentHead({ record: null, gpc: false, config: supplied });
    expect(html).toBe(renderConsentHead({ record: null, gpc: false, config }));
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe(baseline);
      expect(JSON.parse(document.querySelector('#jini-consent-config').textContent).resourcePolicies).toEqual({ '00': baseline, '01': baseline, '10': baseline, '11': baseline });
    } finally { dom.window.close(); }
  });

  it('adds only unsafe-eval to script-src in the initial policy and all four withdrawal/GPC policies', () => {
    const options = { resourceOrigins: ['https://theme.example'], categoryOrigins: { functional: ['https://chat.example'], analytics: ['https://collect.example'] } };
    const baselineDom = new JSDOM(renderConsentHead({ record: null, gpc: false, config }, options));
    const enabledDom = new JSDOM(renderConsentHead({ record: null, gpc: false, config: { ...config, allowUnsafeEval: true } }, options));
    try {
      const before = baselineDom.window.document;
      const after = enabledDom.window.document;
      const initialPolicy = before.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
      expect(after.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe(initialPolicy.replace(" 'unsafe-inline';", " 'unsafe-inline' 'unsafe-eval';"));
      const beforeState = JSON.parse(before.querySelector('#jini-consent-config').textContent);
      const afterState = JSON.parse(after.querySelector('#jini-consent-config').textContent);
      expect(Object.keys(afterState.resourcePolicies).sort()).toEqual(['00', '01', '10', '11']);
      for (const key of ['00', '01', '10', '11']) {
        expect(afterState.resourcePolicies[key]).toBe(beforeState.resourcePolicies[key].replace(" 'unsafe-inline';", " 'unsafe-inline' 'unsafe-eval';"));
      }
      expect({ ...afterState, resourcePolicies: beforeState.resourcePolicies }).toEqual(beforeState);
    } finally { baselineDom.window.close(); enabledDom.window.close(); }
  });

  it('preserves external and explicitly labelled script gating with the exception enabled', async () => {
    const { dom, requests, runtimeErrors } = await browser(gateConsentHtml({ html: page, config: { ...config, allowUnsafeEval: true }, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }));
    try {
      expect(requests).toEqual([]);
      expect(Array.from(dom.window.runs)).toEqual(['necessary']);
      expect(dom.window.document.querySelectorAll('template[data-category="analytics"]')).toHaveLength(2);
      expect(dom.window.document.querySelectorAll('template[data-category="functional"]')).toHaveLength(1);
      expect(runtimeErrors).toEqual([]);
    } finally { dom.window.close(); }
  });

  it('leaves disabled delivery untouched and keeps marketing-granted delivery free of the initial policy', () => {
    expect(gateConsentHtml({ html: page, config: { ...config, enabled: false, allowUnsafeEval: true }, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' })).toBe(page);
    const dom = new JSDOM(renderConsentHead({ record: accepted, gpc: false, config: { ...config, allowUnsafeEval: true } }));
    try { expect(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull(); }
    finally { dom.window.close(); }
  });
});

it('restricts dynamic script origins to the current grants without unsafe-eval and widens on the reloaded page', () => {
  const categoryOrigins = { functional: ['https://chat.example'], analytics: ['https://collect.example'] };
  const policy = (record: typeof accepted | null) => {
    const html = gateConsentHtml({ html: '<html><head></head><body><script>document.createElement("script")</script></body></html>', config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { categoryOrigins });
    const dom = new JSDOM(html);
    try { return dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''; }
    finally { dom.window.close(); }
  };
  const denied = policy(null);
  expect(denied.split('; ')[0]).toBe("script-src 'self' 'unsafe-inline'");
  expect(denied).toContain("object-src 'none'"); expect(denied).not.toContain('unsafe-eval');
  const functional = policy({ ...accepted, choices: { necessary: true, functional: true, analytics: false, marketing: false } });
  expect(functional.split('; ')[0]).toBe("script-src 'self' https://chat.example 'unsafe-inline'");
  expect(functional).not.toContain('collect.example'); expect(functional).not.toContain('unsafe-eval');
  const analytics = policy({ ...accepted, choices: { necessary: true, functional: false, analytics: true, marketing: false } });
  expect(analytics.split('; ')[0]).toBe("script-src 'self' https://collect.example 'unsafe-inline'");
  expect(analytics).not.toContain('chat.example'); expect(analytics).not.toContain('unsafe-eval');
  expect(policy(accepted)).toBe('');
});


it('dropdown and see-more scripts still initialize and respond after rejecting optional consent', async () => {
  const record = { ...accepted, action: 'reject' as const, choices: { necessary: true as const, functional: false, analytics: false, marketing: false } };
  const html = `<html><head></head><body><ul data-jini-dropdown><li><button class="jini-menu-toggle" aria-controls="submenu" aria-expanded="false">Menu</button><ul id="submenu"><li><a href="/page">Page</a></li></ul></li></ul><div data-jini-listing="posts"></div><button hidden data-jini-more="posts" data-jini-more-href="/batch">See more</button><script>${MENU_DROPDOWN_SCRIPT}</script><script>${LISTING_SEE_MORE_SCRIPT}</script></body></html>`;
  const requested: string[] = [];
  const { dom, runtimeErrors } = await browser(gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }));
  try {
    const document = dom.window.document;
    const toggle = document.querySelector('.jini-menu-toggle');
    toggle.click(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const more = document.querySelector('[data-jini-more]');
    expect(more.hidden).toBe(false);
    dom.window.fetch = async (url: string) => { requested.push(url); return { ok: true, text: async () => '<div data-jini-listing-batch><p id="next-item">Next</p></div>' }; };
    more.click(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(requested).toEqual(['/batch']); expect(document.querySelector('#next-item').textContent).toBe('Next');
    expect(document.querySelector('[data-jini-more]')).toBeNull(); expect(runtimeErrors).toEqual([]);
  } finally { dom.window.close(); }
});


describe('metadata, preload and host-link consent regressions', () => {
  const transform = (html: string, options = {}) => gateConsentHtml({ html, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);

  it.each(['', ' data-consent-category="marketing"'])('keeps metadata discoverable with label %s before any consent', label => {
    const rels = ['canonical', 'alternate', 'icon', 'apple-touch-icon', 'manifest', 'author', 'license', 'next', 'prev'];
    const links = rels.map(rel => `<link rel="${rel}" href="https://page.example/${rel}"${label}>`).join('');
    const metadata = `${links}<meta property="og:url" content="https://page.example/"${label}><script type="application/ld+json"${label}>{"@type":"WebPage"}</script>`;
    const dom = new JSDOM(transform(`<html><head>${metadata}</head><body></body></html>`, { pageOrigin: 'https://page.example' }));
    try {
      for (const rel of rels) expect(dom.window.document.head.querySelector(`link[rel="${rel}"]`).href).toBe(`https://page.example/${rel}`);
      expect(dom.window.document.head.querySelector('meta[property="og:url"]').content).toBe('https://page.example/');
      expect(dom.window.document.head.querySelector('script[type="application/ld+json"]').textContent).toBe('{"@type":"WebPage"}');
      expect(dom.window.document.querySelector('template[data-jini-consent-resource],template[data-jini-consent-script]')).toBeNull();
    } finally { dom.window.close(); }
  });

  it('keeps third-party canonical/alternate links but gates fetching metadata from untrusted origins', () => {
    const fetching = ['icon', 'apple-touch-icon', 'manifest', 'next', 'prev', 'alternate icon'].map(rel => `<link rel="${rel}" href="https://tracker.example/${rel.replace(' ', '-')}">`).join('');
    const html = transform(`<html><head><link rel="canonical" href="https://other.example/page"><link rel="alternate" hreflang="de" href="https://other.example/de">${fetching}<link rel="icon" href="https://cdn.example/icon.png"></head><body></body></html>`, { pageOrigin: 'https://page.example', resourceOrigins: ['https://cdn.example'] });
    const dom = new JSDOM(html);
    try {
      const live = Array.from(dom.window.document.head.querySelectorAll(':scope > link'), (link: { getAttribute(name: string): string | null }) => link.getAttribute('href'));
      expect(live).toEqual(['https://other.example/page', 'https://other.example/de', 'https://cdn.example/icon.png']);
      expect(dom.window.document.querySelectorAll('template[data-jini-consent-resource][data-category="marketing"]')).toHaveLength(6);
    } finally { dom.window.close(); }
  });

  it('removes preloads whose image candidates leave trusted origins', () => {
    const html = transform('<link rel="preload" as="image" href="/hero.png" imagesrcset="/hero.png 1x, https://tracker.example/pixel.png 2x"><link rel="preload" as="image" href="/hero.png" imagesrcset="/hero.png 1x, /hero@2x.png 2x">', { pageOrigin: 'https://page.example' });
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('imagesrcset="/hero.png 1x, /hero@2x.png 2x"');
  });

  it('strips executable metadata attributes while preserving the metadata elements', () => {
    const dom = new JSDOM(transform('<html><head><link rel="canonical" href="java&#x09;script:alert(1)" onclick="track()"><meta name="description" content="Page" onload="track()" data-consent-category="analytics"><script type="application/ld+json" onerror="track()" data-consent-category="marketing">{}</script><meta http-equiv="refresh" content="0;url=https://tracker.example"></head><body></body></html>'));
    try {
      const document = dom.window.document;
      expect(document.querySelector('link[rel="canonical"]').hasAttribute('href')).toBe(false);
      expect(document.querySelector('meta[name="description"]').content).toBe('Page');
      expect(document.querySelector('script[type="application/ld+json"]').textContent).toBe('{}');
      expect(document.querySelector('[onclick],[onload],[onerror],[data-jini-consent-attributes],meta[http-equiv="refresh"]')).toBeNull();
    } finally { dom.window.close(); }
  });

  it('keeps local, same-origin and host-trusted preloads while removing third-party hints', () => {
    const hints = ['/font.woff2', 'https://page.example/font.woff2', '//page.example/module.js', 'https://cdn.example/font.woff2', 'https://tracker.example/pixel'].map(href => `<link rel="preload" as="font" href="${href}">`).join('');
    const dom = new JSDOM(transform(`<html><head>${hints}<link rel="preconnect" href="https://tracker.example"></head><body></body></html>`, { pageOrigin: 'https://page.example', resourceOrigins: ['https://cdn.example'] }));
    try {
      expect(Array.from(dom.window.document.querySelectorAll('link'), (link: { getAttribute(name: string): string | null }) => link.getAttribute('href'))).toEqual(['/font.woff2', 'https://page.example/font.woff2', '//page.example/module.js', 'https://cdn.example/font.woff2']);
      expect(dom.window.document.querySelector('template[data-jini-consent-resource]')).toBeNull();
    } finally { dom.window.close(); }
  });

  it('keeps absolute preloads untrusted without host origin evidence', () => {
    const html = transform('<link rel="preload" href="https://page.example/font.woff2">');
    expect(html).not.toContain('href="https://page.example/font.woff2"');
  });

  it('retains the default corner disclosure and first-visit choices in link mode', () => {
    const render = (record: typeof accepted | null, reopen?: 'link') => renderConsentUi({ config: reopen ? { ...config, reopen } : config, record, regionMode: 'opt-in', gpc: false, endpoint: '/api/site-consent' });
    expect(render(accepted)).toContain('<details class="jini-consent-manage">');
    const dom = new JSDOM(render(null, 'link'));
    try {
      expect(dom.window.document.querySelector('#jini-consent').dataset.hasRecord).toBe('false');
      expect(dom.window.document.querySelector('button[value="accept"]').textContent).toBe(config.acceptLabel);
      expect(dom.window.document.querySelector('button[value="reject"]').textContent).toBe(config.rejectLabel);
    } finally { dom.window.close(); }
  });

  it.each([
    '<template><a href="#jini-consent" data-jini-consent-open>Hidden</a></template>',
    '<div data-consent-category="analytics"><a href="#jini-consent" data-jini-consent-open>Gated</a></div>',
    '<a href="/elsewhere" data-jini-consent-open>Wrong target</a>',
  ])('adds an active static reopen anchor when authored controls are unavailable: %s', markup => {
    const html = gateConsentHtml({ html: `<html><body>${markup}</body></html>`, config: { ...config, reopen: 'link', preferencesLabel: 'Cookie <settings>' }, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { ensureReopenLink: true });
    const dom = new JSDOM(html);
    try {
      const link = dom.window.document.querySelector('body > a[href="#jini-consent"][data-jini-consent-open]');
      expect(link.textContent).toBe('Cookie <settings>');
      expect(link.children).toHaveLength(0);
      expect(link.nextElementSibling.id).toBe('jini-consent');
    } finally { dom.window.close(); }
  });

  it('does not insert a static fallback link into ordinary live or disabled HTML', () => {
    const input = { html: '<html><body>Site</body></html>', config, record: null, gpc: false, regionMode: 'opt-in' as const, endpoint: '/api/site-consent' };
    expect(gateConsentHtml(input)).not.toContain('<a href="#jini-consent" data-jini-consent-open>');
    expect(gateConsentHtml({ ...input, config: { ...config, enabled: false } }, { ensureReopenLink: true })).toBe(input.html);
  });

  it('hides the saved link-mode panel without JS and exposes it through the native fragment target', () => {
    const html = gateConsentHtml({ html: '<html><head></head><body><footer><a data-jini-consent-open href="#jini-consent">Cookie preferences</a></footer></body></html>', config: { ...config, reopen: 'link' }, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
    const dom = new JSDOM(html, { url: 'https://site.example/' });
    try {
      const document = dom.window.document;
      const banner = document.querySelector('#jini-consent');
      expect(document.querySelector('[data-jini-consent-open]').getAttribute('href')).toBe('#jini-consent');
      expect(document.querySelector('.jini-consent-pill')).toBeNull();
      expect(dom.window.getComputedStyle(banner).display).toBe('none');
      dom.window.location.hash = 'jini-consent';
      expect(banner.matches(':target')).toBe(true);
      expect(banner.matches('#jini-consent[data-has-record="true"][data-reopen="link"]:not(:target)')).toBe(false);
      expect(document.querySelector('#jini-consent-preferences').open).toBe(true);
      expect(document.querySelector('form').getAttribute('method')).toBe('post');
      expect(document.querySelector('form').getAttribute('action')).toBe('/api/site-consent');
    } finally { dom.window.close(); }
  });

  it('closes fragment-opened preferences after a durable choice', async () => {
    const html = gateConsentHtml({ html: '<html><head></head><body><a href="#jini-consent" data-jini-consent-open>Preferences</a></body></html>', config: { ...config, reopen: 'link' }, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
    const { dom, reloads, runtimeErrors } = await browser(html, false, { fetch: async () => ({ ok: true, json: async () => ({ record: accepted, signals: {} }) }) });
    try {
      dom.window.document.querySelector('[data-jini-consent-open]').click();
      expect(dom.window.location.hash).toBe('#jini-consent');
      dom.window.document.querySelector('button[value="save"]').click();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(dom.window.location.hash).toBe('');
      expect(reloads).toHaveLength(1);
      expect(runtimeErrors).toEqual([]);
    } finally { dom.window.close(); }
  });

  it('opens preferences from a nested click on a dynamically rendered host control', async () => {
    const html = gateConsentHtml({ html: '<html><head></head><body></body></html>', config: { ...config, reopen: 'link' }, record: accepted, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
    const { dom, runtimeErrors } = await browser(html);
    try {
      const document = dom.window.document;
      const control = document.createElement('button');
      control.setAttribute('data-jini-consent-open', '');
      control.innerHTML = '<span>Cookie preferences</span>';
      document.body.appendChild(control);
      control.querySelector('span').click();
      expect(dom.window.location.hash).toBe('#jini-consent');
      expect(document.querySelector('#jini-consent-preferences').open).toBe(true);
      expect(document.activeElement).toBe(document.querySelector('#jini-consent-preferences input[name="functional"]'));
      expect(runtimeErrors).toEqual([]);
    } finally { dom.window.close(); }
  });
});

it('US opt-out defaults retain the same-origin CSP until an explicit saved marketing grant', () => {
  const input = { record: null, gpc: false, regionMode: 'opt-out' as const, config };
  const pending = new JSDOM(renderConsentHead(input));
  const granted = new JSDOM(renderConsentHead({ ...input, record: accepted }));
  try {
    const policy = pending.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content');
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/posthog|jsdelivr/);
    expect(granted.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
  } finally { pending.window.close(); granted.window.close(); }
});

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import { gateConsentHtml, renderConsentUi, renderConsentHead, consentPolicyHref } from '../html/index.js';
import { CONSENT_CLIENT } from '../html/client.js';
import { stripConsentRuntime } from '../html/static.js';
import { CONSENT_CSS } from '../html/styles.js';
import { accepted, config } from './fixtures.js';

// Real installed browser emulator, loaded without adding a types dependency to the no-DOM core.
const { JSDOM, ResourceLoader, CookieJar, VirtualConsole } = createRequire(import.meta.url)('jsdom');
const page = '<!doctype html><html><head><link rel="preload" as="script" href="https://tags.example/track.js"><link rel="modulepreload" href="/module.js"><link rel="preconnect" href="https://tags.example"><style>p{color:red}</style><script data-consent-category="necessary">window.runs=[];window.runs.push("necessary")</script></head><body><p>Site</p><script data-consent-category="analytics" src="https://tags.example/track.js"></script><script data-consent-category="analytics">window.runs.push("inline-analytics")</script><script>window.runs.push("functional")</script><script data-consent-category="typo">window.runs.push("invalid")</script><script type="application/ld+json">{"@type":"Site"}</script><template><script>window.runs.push("authored-template")</script></template></body></html>';
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

describe('delivered HTML consent boundary', () => {
  it('leaves disabled HTML byte-identical and safely gates every optional/unknown script', () => {
    expect(gateConsentHtml({ html: page, config: { ...config, enabled: false }, record: null, gpc: false, regionMode: 'opt-out', endpoint: '/api/site-consent' })).toBe(page);
    const html = gate();
    expect(html).not.toContain('rel="preload"'); expect(html).not.toContain('rel="modulepreload"'); expect(html).not.toContain('rel="preconnect"');
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
    const html = gateConsentHtml({ html: '<!doctype html><html><body><link rel="preload" as="fetch" href="https://tags.example/hidden.js"><svg><script>window.tracked=true</script></svg></body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
    expect(html.startsWith('<!doctype html><html>')).toBe(true);
    expect(html).not.toContain('window.tracked=true');
    expect(html).not.toContain('<svg><template');
    expect(html).not.toContain('https://tags.example/hidden.js');
  });
});


describe('consent security regressions', () => {
  const transform = (html: string, record: typeof accepted | null = null, options = {}) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  it('page runtime markers and self-declared necessity cannot exempt scripts or their neighbors', async () => {
    const html = transform('<html><head></head><body><div data-jini-consent-runtime></div><script data-jini-consent-runtime="forged" data-consent-category="necessary">window.leaked=true</script><script>window.neighbor=true</script></body></html>', null, { runtimeToken: 'host-response-token' });
    const { dom } = await browser(html);
    try { expect(dom.window.leaked).toBeUndefined(); expect(dom.window.neighbor).toBeUndefined(); expect(dom.window.document.querySelectorAll('template[data-jini-consent-script]').length).toBe(2); }
    finally { dom.window.close(); }
  });
  it('only exact host manifest entries remain necessary, even with hostile same-origin labels', async () => {
    const content = 'window.essential=true';
    const { dom } = await browser(transform(`<html><head></head><body><script>${content}</script><script src="/rogue.js" data-consent-category="necessary"></script></body></html>`, null, { necessaryScripts: [{ content }] }));
    try { expect(dom.window.essential).toBe(true); expect(dom.window.document.querySelector('script[src="/rogue.js"]')).toBeNull(); }
    finally { dom.window.close(); }
  });
  it('a functional-only grant cannot release untagged third-party tags', async () => {
    const { dom, requests } = await browser(transform('<html><head></head><body><script src="https://tags.example/untagged.js"></script></body></html>', { ...accepted, choices: { necessary: true, functional: true, analytics: false, marketing: false } }));
    try { expect(requests).toEqual([]); expect(dom.window.document.querySelector('template').dataset.category).toBe('marketing'); }
    finally { dom.window.close(); }
  });
  it('blocks frames, media, pixels, noscript, fonts, CSS, hints and event handlers before opt-in, including without JS', () => {
    const html = transform('<html><head><link rel="prerender" href="https://tags.example"><link rel="stylesheet" href="https://tags.example/site.css"><style>@font-face{src:url(https://tags.example/font.woff)}</style></head><body onload="window.leaked=true"><iframe srcdoc="&lt;img src=https://tags.example/pixel&gt;"></iframe><img src="https://tags.example/pixel"><img src="/photo.png" srcset="/photo.png 1x, https://tags.example/pixel 2x"><video poster="https://tags.example/pixel" src="/movie.mp4"></video><embed src="https://tags.example/pixel"><object data="https://tags.example/pixel"></object><noscript><img src="https://tags.example/nojs"></noscript><button onclick="window.leaked=true" style="background:url(https://tags.example/pixel)">Click</button></body></html>');
    for (const enabled of [false, true]) {
      const dom = new JSDOM(html, { runScripts: enabled ? 'dangerously' : undefined });
      try {
        const document = dom.window.document;
        expect(document.querySelectorAll('iframe,img,video,embed,object,noscript,link[rel=stylesheet]').length).toBe(0);
        expect(document.querySelector('link[rel=prerender]')).toBeNull();
        expect(document.querySelector('style:not([data-jini-consent-style])')).toBeNull();
        expect(document.querySelectorAll('[onclick],[onload],button[style]').length).toBe(0);
        expect(document.querySelectorAll('template[data-jini-consent-resource]').length).toBe(9);
      } finally { dom.window.close(); }
    }
  });
  it('replays late theme DOMContentLoaded listeners once without replaying essential listeners', async () => {
    const essential = 'window.early=0;document.addEventListener("DOMContentLoaded",function(){window.early++})';
    const { dom } = await browser(transform(`<html><head><script>${essential}</script></head><body><script>document.addEventListener("DOMContentLoaded",function(){window.themeReady=(window.themeReady||0)+1},{once:true})</script></body></html>`, accepted, { necessaryScripts: [{ content: essential }] }));
    try { expect(dom.window.themeReady).toBe(1); expect(dom.window.early).toBe(1); }
    finally { dom.window.close(); }
  });
  it('California is opt-out, navigator GPC still prevents advertising requests, and rejection persists', async () => {
    const html = gateConsentHtml({ html: page, config, record: null, gpc: false, regionMode: 'opt-out', endpoint: '/api/site-consent' }, { necessaryScripts });
    const yes = await browser(html), gpc = await browser(html, true);
    try { expect(yes.requests).toEqual(['https://tags.example/track.js']); expect(gpc.requests).toEqual([]); expect(yes.dom.window.dataLayer[1][2].ad_storage).toBe('granted'); }
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
    try { expect(dom.window.document.querySelector('script[type="text/x-template"]').textContent).toBe('<div>Template</div>'); expect(dom.window.document.querySelector('template[data-jini-consent-script]').content.querySelector('script').type).toBe('importmap'); }
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
  const policy = "style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; connect-src 'self'";
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


it.each(['text/x-javascript', 'application/x-javascript', 'text/jscript', 'text/livescript', ...Array.from({ length: 6 }, (_, n) => `text/javascript1.${n}`), 'application/x-ecmascript', 'text/x-ecmascript', 'text/javascript; charset=utf-8', 'speculationrules', 'future-executable-type'])('denies script type %s until consent', async type => {
  const html = gateConsentHtml({ html: `<html><body><script type="${type}">window.mimeLeak=true</script></body></html>`, config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' });
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
    expect(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toBe("style-src 'self' https://theme.example 'unsafe-inline'; font-src 'self' https://theme.example data:; img-src 'self' https://theme.example data: blob:; media-src 'self' https://theme.example; frame-src 'self' https://theme.example; connect-src 'self' https://theme.example");
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
  it('keeps only the exact host runtime for this response; a matching token on other code is gated and unmarked', () => {
    const runtime = `<script data-jini-consent-runtime="host-token">${CONSENT_CLIENT}</script>`;
    const html = transform(`<html><head></head><body>${runtime}<script data-jini-consent-runtime="host-token">window.other=true</script></body></html>`, { runtimeToken: 'host-token' });
    expect(html).toContain(`</section>${runtime}<template data-jini-consent-script data-category="functional"><script>window.other=true</script></template></body>`);
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
    const html = transform('<html><body><script src="/essential.js"></script><script src="/other.js"></script></body></html>', { necessaryScripts: [{ src: '/essential.js' }] });
    expect(html).toContain('<body><section'); expect(html).toContain('</section><script src="/essential.js"></script><template data-jini-consent-script data-category="functional"><script src="/other.js"></script></template>');
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
    const html = transform(page);
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
    expect(analytics).toBe("style-src 'self' https://collect.example 'unsafe-inline'; font-src 'self' https://collect.example data:; img-src 'self' https://collect.example data: blob:; media-src 'self' https://collect.example; frame-src 'self' https://collect.example; connect-src 'self' https://collect.example");
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
  it('pins the control to a corner instead of leaving a static box at the top of the page', () => {
    expect(CONSENT_CSS).not.toContain('position:static');
    expect(CONSENT_CSS).toMatch(/\.jini-consent\[data-has-record="true"\]\{[^}]*inset:auto auto 1rem 1rem/);
  });
});


describe('review regressions: ambiguous HTML and URL normalization', () => {
  const transform = (html: string, record: typeof accepted | null = null, options = {}) => gateConsentHtml({ html, config, record, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, options);
  it.each(['onerror', 'ONERROR', 'OnError'])('never exposes an ignored duplicate %s handler after deferring the first', async duplicate => {
    const html = transform(`<html><body><img id="probe" src="/bad" onerror="window.leaked=1" ${duplicate}="window.leaked=2"></body></html>`);
    const { dom, runtimeErrors } = await browser(html);
    try {
      const image = dom.window.document.getElementById('probe');
      expect(image.hasAttribute('onerror')).toBe(false);
      image.dispatchEvent(new dom.window.Event('error'));
      expect(dom.window.leaked).toBeUndefined();
      expect(JSON.parse(image.dataset.jiniConsentAttributes)).toEqual({ onerror: 'window.leaked=1' });
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

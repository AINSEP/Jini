import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { gateConsentHtml, renderConsentUi, consentPolicyHref } from '../html/index.js';
import { CONSENT_CLIENT } from '../html/client.js';
import { stripConsentRuntime } from '../html/static.js';
import { accepted, config } from './fixtures.js';

// Real installed browser emulator, loaded without adding a types dependency to the no-DOM core.
const { JSDOM, ResourceLoader } = createRequire(import.meta.url)('jsdom');
const page = '<!doctype html><html><head><link rel="preload" as="script" href="https://tags.example/track.js"><link rel="modulepreload" href="/module.js"><link rel="preconnect" href="https://tags.example"><style>p{color:red}</style><script data-consent-category="necessary">window.runs=[];window.runs.push("necessary")</script></head><body><p>Site</p><script data-consent-category="analytics" src="https://tags.example/track.js"></script><script data-consent-category="analytics">window.runs.push("inline-analytics")</script><script>window.runs.push("functional")</script><script data-consent-category="typo">window.runs.push("invalid")</script><script type="application/ld+json">{"@type":"Site"}</script><template><script>window.runs.push("authored-template")</script></template></body></html>';
const necessaryScripts = [{ content: 'window.runs=[];window.runs.push("necessary")' }];
const gate = (record = null as typeof accepted | null, gpc = false) => gateConsentHtml({ html: page, config, record, gpc, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { necessaryScripts });

async function browser(html: string, browserGpc = false) {
  const requests: string[] = [];
  class Loader extends ResourceLoader {
    fetch(url: string) { requests.push(url); return Promise.resolve(Buffer.from('window.runs.push("external-analytics");')); }
  }
  const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'dangerously', resources: new Loader(), beforeParse(window: { navigator: object }) { Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: browserGpc }); } });
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  await new Promise<void>(resolve => setImmediate(resolve));
  return { dom, requests };
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
  it('honors navigator GPC even if the request header missed it; opens the no-sale controls by keyboard/click', async () => {
    const { dom, requests } = await browser(gate(accepted), true);
    try {
      expect(requests).toEqual([]); expect(Array.from(dom.window.runs)).toEqual(['necessary', 'functional']);
      expect(dom.window.document.querySelector('[name=marketing]').disabled).toBe(true);
      expect(dom.window.document.querySelector('[name=analytics]').checked).toBe(false);
      expect(dom.window.dataLayer[1][2].ad_personalization).toBe('denied');
      dom.window.document.querySelector('[data-jini-do-not-sell]').click();
      expect(dom.window.document.getElementById('jini-consent-preferences').open).toBe(true);
      expect(dom.window.document.activeElement.getAttribute('data-jini-do-not-sell-button')).toBe('');
    } finally { dom.window.close(); }
  });
  it('a failed enhanced save displays the server error and never releases optional code', async () => {
    const { dom, requests } = await browser(gate());
    const submissions: unknown[] = [];
    dom.window.fetch = async (url: string, options: { body: { toString(): string } }) => {
      submissions.push({ url, body: options.body.toString() });
      return { ok: false, json: async () => ({ error: 'Cookie preferences could not be saved. Optional scripts remain paused. Please try again.' }) };
    };
    try {
      const form = dom.window.document.querySelector('#jini-consent form');
      const button = form.querySelector('button[value=accept]');
      form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(submissions).toEqual([{ url: 'https://site.example/api/site-consent', body: 'policyVersion=1&gpc=0&action=accept' }]);
      expect(dom.window.document.querySelector('[data-jini-consent-error]').textContent).toBe('Cookie preferences could not be saved. Optional scripts remain paused. Please try again.');
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
  expect(() => gateConsentHtml({ html: '<html><body>Page</body></html>', config, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { resourceOrigins: ["https://theme.example/"] })).toThrow('Consent resource origins must be HTTP(S) origins.');
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

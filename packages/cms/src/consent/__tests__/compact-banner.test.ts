import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderConsentHead, renderConsentUi } from '../html/index.js';
import { CONSENT_CLIENT } from '../html/client.js';
import { CONSENT_CSS } from '../html/styles.js';
import { accepted, config } from './fixtures.js';

const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
const SMALL = '@media(max-width:640px){';
const smallScreenCss = CONSENT_CSS.slice(CONSENT_CSS.indexOf(SMALL));
const wideScreenCss = CONSENT_CSS.slice(0, CONSENT_CSS.indexOf(SMALL));
const render = (record: typeof accepted | null = null, regionMode: 'opt-in' | 'opt-out' = 'opt-in') => renderConsentUi({ config, record, regionMode, gpc: false, endpoint: '/api/site-consent' });

describe('compact first-visit banner on small screens', () => {
  it('tightens the sheet, runs the title into the message and keeps 40px actions only at widths up to 640px', () => {
    expect(smallScreenCss).toContain('.jini-consent{inset:auto 0 0;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));');
    expect(smallScreenCss).toContain('.jini-consent h2{display:inline;font-size:14px;margin:0 6px 0 0}');
    expect(smallScreenCss).toContain('.jini-consent>.jini-consent-initial{display:contents}');
    expect(smallScreenCss).toContain('.jini-consent>.jini-consent-initial p{display:inline;font-size:12.5px}');
    expect(smallScreenCss).toContain('.jini-consent>.jini-consent-initial p+p{display:none}');
    // Smaller type, but every action stays a comfortable tap target.
    expect(smallScreenCss).toContain('.jini-consent button{min-height:40px;padding:0 10px;font-size:13px}');
    expect(smallScreenCss).toContain('.jini-consent summary,.jini-consent [data-jini-do-not-sell-button]{min-height:28px}');
    // Wider screens keep the full two-paragraph card with a block title.
    expect(wideScreenCss).not.toMatch(/p\+p\{display:none\}|display:contents|h2\{display:inline/);
  });

  it.each(['opt-in', 'opt-out'] as const)('targets the text block, its second paragraph and keeps both equal actions in %s', regionMode => {
    const dom = new JSDOM(render(null, regionMode));
    try {
      const document = dom.window.document;
      const text = [...document.querySelectorAll('.jini-consent>.jini-consent-initial')];
      expect(text).toHaveLength(1);
      expect(text[0].querySelector('h2').textContent).toBe(config.title);
      // The message stays visible inline, followed by the privacy link in the same text flow.
      expect(text[0].nextElementSibling.textContent).toBe('Privacy policy');
      const hidden = [...document.querySelectorAll('.jini-consent>.jini-consent-initial p+p')];
      expect(hidden).toHaveLength(1);
      expect(hidden[0].previousElementSibling.textContent).toBe(config.message);
      expect(document.querySelector('[data-jini-gpc-note]').matches('.jini-consent>.jini-consent-initial p')).toBe(false);
      const actions = [...document.querySelectorAll('.jini-consent-actions.jini-consent-initial button')].map((button: { value: string }) => button.value);
      expect(actions).toEqual(regionMode === 'opt-out' ? ['accept'] : ['reject', 'accept']);
      expect(document.querySelector('#jini-consent-preferences>summary').textContent).toBe(config.preferencesLabel);
    } finally { dom.window.close(); }
  });
});

type Observed = { callback: () => void; element: unknown };
/** Runs the real client with a controllable ResizeObserver and viewport query; jsdom has no layout. */
async function page({ record = null, small = true }: { record?: typeof accepted | null; small?: boolean }) {
  const viewport = { small };
  const observers: Observed[] = [];
  const virtualConsole = new VirtualConsole();
  const errors: unknown[] = [];
  virtualConsole.on('jsdomError', (error: Error) => errors.push(error));
  const html = `<!doctype html><html><head>${renderConsentHead({ record, gpc: false, config })}</head><body><p>Site</p>${render(record)}</body></html>`;
  const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'dangerously', virtualConsole, beforeParse(window: Record<string, unknown>) {
    window.ResizeObserver = class { constructor(private callback: () => void) {} observe(element: unknown) { observers.push({ callback: this.callback, element }); } disconnect() {} };
    // A live result like the browser's: rotating a phone flips it without a new query object.
    window.matchMedia = (query: string) => ({ get matches() { return query === '(max-width:640px)' && viewport.small; } });
  } });
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  const document = dom.window.document;
  const banner = document.getElementById('jini-consent');
  const resize = (height: number) => {
    Object.defineProperty(banner, 'offsetHeight', { configurable: true, value: height });
    observers.filter(observer => observer.element === banner).forEach(observer => observer.callback());
  };
  return { dom, document, banner, resize, errors, observers, viewport };
}

describe('page space reserved under the small-screen banner', () => {
  it('pads the page end by the banner height while it is open, and clears it when the banner closes', async () => {
    const { dom, document, resize, errors } = await page({});
    try {
      document.body.style.paddingBottom = '';
      resize(148);
      expect(document.body.style.paddingBottom).toBe('148px');
      resize(152);
      expect(document.body.style.paddingBottom).toBe('152px');
      resize(0);
      expect(document.body.style.paddingBottom).toBe('');
      expect(errors).toEqual([]);
    } finally { dom.window.close(); }
  });

  it('keeps host padding underneath the reserve and puts it back when the banner closes', async () => {
    const { dom, document, resize } = await page({});
    try {
      document.body.style.setProperty('padding-bottom', '12px', 'important');
      resize(150);
      expect(document.body.style.paddingBottom).toBe('162px');
      expect(document.body.style.getPropertyPriority('padding-bottom')).toBe('important');
      resize(0);
      expect(document.body.style.paddingBottom).toBe('12px');
      expect(document.body.style.getPropertyPriority('padding-bottom')).toBe('important');
    } finally { dom.window.close(); }
  });

  it('drops the reserve when the viewport widens past 640px and the sheet becomes the corner card', async () => {
    const { dom, document, resize, viewport } = await page({});
    try {
      resize(150);
      expect(document.body.style.paddingBottom).toBe('150px');
      viewport.small = false;
      resize(243);
      expect(document.body.style.paddingBottom).toBe('');
    } finally { dom.window.close(); }
  });

  it('still wires the choice buttons when the reserve is set up', async () => {
    const { dom, document, resize, errors } = await page({});
    try {
      resize(150);
      const fetches: string[] = [];
      dom.window.fetch = async (url: string) => { fetches.push(url); return new dom.window.Response('{}', { status: 500 }); };
      (document.querySelector('button[value="reject"]') as { click(): void }).click();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(fetches.map(url => new URL(String(url), 'https://site.example/').pathname)).toEqual(['/api/site-consent']);
      expect(errors).toEqual([]);
    } finally { dom.window.close(); }
  });

  it('reserves nothing for the desktop corner card and leaves host padding alone', async () => {
    const { dom, document, resize } = await page({ small: false });
    try {
      document.body.style.paddingBottom = '7px';
      resize(262);
      expect(document.body.style.paddingBottom).toBe('7px');
    } finally { dom.window.close(); }
  });

  it('reserves nothing once a choice exists (only the saved-choice pill remains)', async () => {
    const { dom, document, resize } = await page({ record: accepted });
    try {
      resize(40);
      expect(document.body.style.paddingBottom).toBe('');
    } finally { dom.window.close(); }
  });
});

describe('client size budget', () => {
  it('stays under the 4608-byte gzip budget even before minification (comments and indentation removed)', () => {
    // A conservative bound: a real minifier only shrinks this further.
    const stripped = CONSENT_CLIENT.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//')).join('\n');
    expect(gzipSync(stripped).length).toBeLessThanOrEqual(4608);
  });
});

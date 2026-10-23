import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CONSENT_PLACEMENTS, compileConsentCss, type ConsentConfig } from '../index.js';
import { gateConsentHtml, renderConsentUi, renderConsentHead } from '../html/index.js';
import { CONSENT_CSS } from '../html/styles.js';
import { accepted, config } from './fixtures.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const render = (overrides: Partial<ConsentConfig>, record: typeof accepted | null = null) => renderConsentUi({ config: { ...config, ...overrides }, record, regionMode: 'opt-in', gpc: false, endpoint: '/api/site-consent' });

describe('consent appearance and secondary policy link', () => {
  it.each(CONSENT_PLACEMENTS)('renders %s with initial-state-only desktop placement rules', placement => {
    const dom = new JSDOM(render({ placement }));
    try {
      const banner = dom.window.document.querySelector('#jini-consent');
      expect(banner.getAttribute('data-placement')).toBe(placement);
      expect(banner.getAttribute('data-has-record')).toBe('false');
      expect(CONSENT_CSS).toContain(`#jini-consent[data-has-record="false"]:where([data-placement="${placement}"])`);
    } finally { dom.window.close(); }
  });
  it('defaults to bottom-bar and retains a closed saved-choice disclosure for every placement', () => {
    expect(render({})).toContain('data-placement="bottom-bar"');
    for (const placement of CONSENT_PLACEMENTS) {
      const dom = new JSDOM(render({ placement }, accepted));
      try {
        expect(dom.window.document.querySelector('#jini-consent').getAttribute('data-has-record')).toBe('true');
        expect(dom.window.document.querySelector('.jini-consent-manage').open).toBe(false);
        expect(dom.window.document.querySelector('.jini-consent-pill').textContent).toBe(config.preferencesLabel);
      } finally { dom.window.close(); }
    }
    expect(CONSENT_CSS).toContain('.jini-consent[data-has-record="true"]{inset:auto auto 1rem 1rem');
  });
  it('renders the escaped secondary link immediately after the privacy link', () => {
    const dom = new JSDOM(render({ secondaryLinkLabel: '<Cookie policy>', secondaryLinkUrl: '/cookies?x=1&y=2' }));
    try {
      const links = [...dom.window.document.querySelectorAll('#jini-consent a')];
      expect(links.map((link: { textContent: string }) => link.textContent)).toEqual(['Privacy policy', '<Cookie policy>']);
      expect(links[0].nextSibling.textContent).toBe(' · ');
      expect(links[1].nextSibling.textContent.trim()).toBe('');
      expect(links[1].getAttribute('href')).toBe('/cookies?x=1&y=2');
      expect(dom.window.document.querySelector('cookie')).toBeNull();
    } finally { dom.window.close(); }
    expect(render({ secondaryLinkLabel: 'Cookies', secondaryLinkUrl: 'https://example.com/cookies' })).toContain('<a href="https://example.com/cookies">Cookies</a>');
  });
  it.each([
    'javascript:alert(1)', '\tjava\nscript:alert(1)', 'jav&#97;script:alert(1)', '&#106;avascript:alert(1)',
    '//evil.example', '/\\evil.example', '/\t/evil.example', 'data:text/html,x',
    'http://example.com/cookies', 'https://user:password@example.com/cookies',
  ])('omits unsafe secondary link %s', secondaryLinkUrl => {
    const html = render({ secondaryLinkLabel: 'Secondary policy', secondaryLinkUrl });
    const dom = new JSDOM(html);
    try {
      expect([...dom.window.document.querySelectorAll('a')].map((link: { textContent: string }) => link.textContent)).toEqual(['Privacy policy']);
      expect(dom.window.document.querySelector('script')).toBeNull();
    } finally { dom.window.close(); }
  });
  it.each([null, accepted])('renders one native no-sale submission control with record %s', record => {
    const dom = new JSDOM(render({}, record));
    try {
      const document = dom.window.document;
      const controls = [...document.querySelectorAll('#jini-consent button, #jini-consent a')]
        .filter((control: { textContent: string }) => control.textContent === 'Do Not Sell or Share');
      expect(controls).toHaveLength(1);
      const button = controls[0];
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('submit');
      expect(button.id).toBe('jini-consent-do-not-sell');
      expect(button.hasAttribute('data-jini-do-not-sell-button')).toBe(true);
      expect(button.name).toBe('action');
      expect(button.value).toBe('do-not-sell');
      expect(button.form.getAttribute('method')).toBe('post');
      expect(button.form.getAttribute('action')).toBe('/api/site-consent');
      const preferences = document.querySelector('#jini-consent-preferences');
      expect(preferences.tagName).toBe('DETAILS');
      expect(preferences.open).toBe(record !== null);
      expect(preferences.querySelector('summary').textContent).toBe(config.preferencesLabel);
      expect(preferences.contains(button)).toBe(false);
      expect([...document.querySelectorAll('.jini-consent-initial button')].map((action: { value: string }) => action.value)).toEqual(['reject', 'accept']);
      expect(document.querySelector('[data-jini-do-not-sell]')).toBeNull();
      expect(button.form.querySelectorAll('.jini-consent-category input')).toHaveLength(4);
      expect(document.querySelector('#jini-consent').getAttribute('aria-label')).toBe('Cookie preferences');
      expect(document.querySelector('[data-jini-consent-error]').getAttribute('role')).toBe('alert');
    } finally { dom.window.close(); }
  });
  it('exposes the theme palette, equal-width action grid and reduced-motion contract', () => {
    expect(CONSENT_CSS).toContain('--consent-bg:var(--jini-surface,var(--bg,Canvas))');
    expect(CONSENT_CSS).toContain('--consent-fg:var(--jini-text,var(--fg,CanvasText))');
    expect(CONSENT_CSS).toContain('--consent-border:var(--jini-border,var(--border,color-mix(');
    expect(CONSENT_CSS).toContain('--consent-accent:var(--jini-accent,var(--accent,var(--consent-fg)))');
    for (const token of ['button-bg', 'button-hover-bg', 'button-border']) {
      expect(CONSENT_CSS).toContain(`--consent-${token}:color-mix(`);
    }
    expect(CONSENT_CSS).toContain('grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr))');
    expect(CONSENT_CSS).not.toMatch(/button\[.*(?:accept|reject)/);
    expect(CONSENT_CSS).toContain('@media(prefers-reduced-motion:reduce){.jini-consent,.jini-consent *{transition:none!important;animation:none!important}}');
  });
  it('uses full-contrast notice and legend text and a text-colored focus ring', () => {
    expect(CONSENT_CSS).toMatch(/\.jini-consent p\{[^}]*color:inherit/);
    expect(CONSENT_CSS).toMatch(/\.jini-consent legend\{[^}]*color:inherit/);
    expect(CONSENT_CSS).toContain(':focus-visible{outline:3px solid currentColor;outline-offset:2px');
  });
  it('requires both secondary fields and safely preserves entity-looking local paths', () => {
    expect(render({ secondaryLinkUrl: '/cookies' })).not.toContain('href="/cookies"');
    expect(render({ secondaryLinkLabel: 'Cookies' })).not.toContain('>Cookies</a>');
    const dom = new JSDOM(render({ secondaryLinkLabel: '&lt;Cookies&gt;', secondaryLinkUrl: '/&Tab;/cookies' }));
    try {
      const link = dom.window.document.querySelectorAll('a')[1];
      expect(link.textContent).toBe('&lt;Cookies&gt;');
      expect(link.getAttribute('href')).toBe('/&Tab;/cookies');
    } finally { dom.window.close(); }
  });
  it('keeps invalid runtime placement values out of HTML attributes', () => {
    const html = render({ placement: 'top-bar" onclick="alert(1)' as NonNullable<ConsentConfig['placement']> });
    expect(html).toContain('data-placement="bottom-bar"');
    expect(html).not.toContain('onclick');
  });
  it('passes appearance through the real gate into its nonce style after base styles', () => {
    const appearance: Partial<ConsentConfig> = { appearance: { backgroundColor: '#111', textColor: '#fff', padding: '24px' }, customCss: '#jini-consent{border-radius:17px}', placement: 'top-bar' };
    const html = gateConsentHtml({ html: '<html><head></head><body><p>Content</p></body></html>', config: { ...config, ...appearance }, record: null, gpc: false, regionMode: 'opt-in', endpoint: '/api/site-consent' }, { nonce: 'preview-nonce' });
    const dom = new JSDOM(html);
    try {
      const style = dom.window.document.querySelector('style[data-jini-consent-style]');
      expect(style.getAttribute('nonce')).toBe('preview-nonce');
      expect(style.textContent.startsWith(CONSENT_CSS)).toBe(true);
      expect(style.textContent).toContain(compileConsentCss({ css: appearance.customCss!, tokens: appearance.appearance! }).css);
      expect(style.textContent.indexOf('border-radius:17px')).toBeLessThan(style.textContent.indexOf('/* ENGINE PARITY BLOCK */'));
      expect(dom.window.document.querySelector('#jini-consent').getAttribute('data-placement')).toBe('top-bar');
    } finally { dom.window.close(); }
  });
  it('never injects rejected CSS or a style breakout through the renderer', () => {
    const html = renderConsentHead({ record: null, gpc: false, config: { ...config, customCss: '#jini-consent{display:none}</style><script id="injected">alert(1)</script>' } });
    const dom = new JSDOM(html);
    try {
      expect(dom.window.document.querySelector('#injected')).toBeNull();
      const style = dom.window.document.querySelector('style[data-jini-consent-style]').textContent;
      expect(style).not.toContain('#jini-consent{display:none}');
      expect(style.endsWith(compileConsentCss({}).css)).toBe(true);
    } finally { dom.window.close(); }
  });
});

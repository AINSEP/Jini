import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CONSENT_PLACEMENTS, type ConsentRecord } from '../types.js';
import { gateConsentHtml } from '../html/index.js';
import { stripConsentRuntime } from '../html/static.js';
import { accepted, config } from './fixtures.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const page = '<!doctype html><html><head></head><body><main>Page</main></body></html>';
const rejected: ConsentRecord = { ...accepted, action: 'reject', choices: { necessary: true, functional: false, analytics: false, marketing: false } };

/** Exercise the delivered CSS and native disclosure/fragment states with scripts disabled. */
function fixture({ record, placement = 'bottom-right', reopen = 'corner', hash = '' }: {
  record: ConsentRecord | null; placement?: typeof CONSENT_PLACEMENTS[number]; reopen?: 'corner' | 'link'; hash?: string;
}, _options = {}) {
  const html = gateConsentHtml({ html: page, config: { ...config, placement, reopen }, record, regionMode: 'opt-in', gpc: false, endpoint: '/api/site-consent' });
  const dom = new JSDOM(html, { url: `https://site.example/${hash}` });
  const display = () => dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue('--jini-floating-ui-display').trim();
  return { dom, html, document: dom.window.document, display };
}

describe('consent priority over floating UI', () => {
  it.each(CONSENT_PLACEMENTS)('suspends floating UI throughout the first %s banner', placement => {
    const f = fixture({ record: null, placement });
    try {
      expect(f.display()).toBe('none');
      f.document.querySelector('#jini-consent-preferences').open = true;
      f.document.querySelector('[data-jini-consent-error]').hidden = false;
      expect(f.display()).toBe('none');
      expect(f.dom.window.getComputedStyle(f.document.querySelector('#jini-consent')).zIndex).toBe('2147483647');
      expect([...f.document.querySelectorAll('.jini-consent-initial button')].map((button: HTMLButtonElement) => button.textContent)).toEqual(['Reject non-essential', 'Accept all']);
    } finally { f.dom.window.close(); }
  });

  for (const record of [accepted, rejected]) {
    it.each(CONSENT_PLACEMENTS)(`${record.action}: restores floating UI until the %s corner panel reopens`, placement => {
      const f = fixture({ record, placement });
      try {
        // The inner preferences disclosure is open even when its outer disclosure is closed.
        expect(f.document.querySelector('#jini-consent-preferences').open).toBe(true);
        expect(f.display()).toBe('');
        const manage = f.document.querySelector('.jini-consent-manage');
        manage.open = true;
        expect(f.display()).toBe('none');
        manage.open = false;
        expect(f.display()).toBe('');
      } finally { f.dom.window.close(); }
    });

    it(`${record.action}: suspends floating UI only at the native preferences fragment in link mode`, () => {
      for (const hash of ['', '#jini-consent', '#content']) {
        const f = fixture({ record, reopen: 'link', hash });
        try {
          expect(f.display()).toBe(hash === '#jini-consent' ? 'none' : '');
        } finally { f.dom.window.close(); }
      }
    });
  }

  it('does not suspend floating UI when consent is absent or stripped from a static export', () => {
    const f = fixture({ record: null });
    try {
      for (const html of [page, stripConsentRuntime({ html: f.html })]) {
        const dom = new JSDOM(html);
        try {
          expect(dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue('--jini-floating-ui-display')).toBe('');
        } finally { dom.window.close(); }
      }
    } finally { f.dom.window.close(); }
  });
});

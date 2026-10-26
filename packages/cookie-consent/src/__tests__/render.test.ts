import { describe, expect, test } from 'vitest';
import { CONFIG_ID } from '../contract.js';
import { BASE_CSS, DEFAULT_COPY, renderBanner, resolveCopy, safeHref } from '../render/index.js';

const client = { contract: 1 as const, policy: '2026-10-26', regionMode: 'auto' as const };
const config = (over: object = {}) => ({ mode: 'jini' as const, client, copy: {}, ...over });
/** The JSON page config the client will read, parsed back from the rendered head. */
const pageConfig = (head: string) => JSON.parse(new RegExp(`<script type="application/json" id="${CONFIG_ID}">(.*?)</script>`).exec(head)![1]!);

describe('renderBanner modes', () => {
  test('off emits only the anonymous runtime; an unknown mode emits nothing', () => {
    const off = renderBanner(config({ mode: 'off' }), { clientSrc: '/client.js' });
    expect(pageConfig(off.head).banner).toBe('off');
    expect(off.head).toContain('src="/client.js"');
    expect(off.head).not.toContain('<style');
    expect(off.body).toBe('');
    expect(renderBanner(config({ mode: 'popup' as never })).head).toBe('');
  });

  test('headless emits the config and the client script, but no banner markup or CSS', () => {
    const out = renderBanner(config({ mode: 'headless' }), { clientSrc: '/consent/client.min.js' });
    expect(out.body).toBe('');
    expect(out.head).not.toContain('<style');
    expect(out.head).toContain('<script src="/consent/client.min.js" defer></script>');
    expect(pageConfig(out.head)).toEqual({ ...client, banner: 'headless', evidence: { mode: 'local' } });
  });

  test('jini emits style + config + script in the head and the hidden banner + reopen button in the body', () => {
    const evidence = { mode: 'durable' as const, endpoint: '/_consent' };
    const out = renderBanner(config(), { clientSrc: '/c.js', evidence, nonce: 'n"1' });
    expect(out.head.indexOf('<style data-jini-consent-style nonce="n&quot;1">')).toBe(0);
    expect(out.head).toContain(BASE_CSS);
    expect(out.head).toContain('/* ENGINE PARITY BLOCK */');
    expect(out.head).toContain('<script src="/c.js" defer nonce="n&quot;1"></script>');
    expect(pageConfig(out.head).evidence).toEqual(evidence);
    expect(out.body).toMatch(/^<section id="jini-consent"[^>]* data-evidence="durable" hidden>/);
    expect(out.body).toContain('<button type="button" class="jini-consent-reopen" data-consent-open>Privacy choices</button>');
    expect(out.htmlAttrs).toBe('');
  });

  test('no clientSrc = no script tag (the host loads the client itself)', () => {
    expect(renderBanner(config()).head).not.toContain('<script src');
  });

  test('the JSON config cannot close its <script> element', () => {
    const out = renderBanner(config({ client: { ...client, policy: '</script><script>alert(1)</script>' } }));
    expect(out.head).not.toContain('</script><script>alert');
    expect(pageConfig(out.head).policy).toBe('</script><script>alert(1)</script>');
  });
});

describe('banner markup', () => {
  test('identical for every visitor: both region variants and the GPC note are always in the markup', () => {
    const { body } = renderBanner(config());
    expect(body).toContain('data-consent-action="reject" data-consent-only="opt-in"');
    expect(body).toContain('data-consent-action="do-not-sell" class="jini-consent-link" data-consent-only="opt-out"');
    expect(body).toContain('<p data-consent-gpc>');
    expect(body).toContain('<p role="alert" data-consent-error hidden>');
    expect(body).toContain('<input type="checkbox" name="necessary" checked disabled>');
    for (const name of ['functional', 'analytics', 'marketing']) expect(body).toContain(`<input type="checkbox" name="${name}">`);
    expect(renderBanner(config()).body).toBe(body);
  });

  test('placement falls back to bottom-bar; reopen "link" drops the corner button', () => {
    expect(renderBanner(config(), { placement: 'top-bar' }).body).toContain('data-placement="top-bar"');
    expect(renderBanner(config(), { placement: 'middle' as never }).body).toContain('data-placement="bottom-bar"');
    expect(renderBanner(config(), { reopen: 'link' }).body).not.toContain('jini-consent-reopen');
  });

  test('all owner copy is escaped', () => {
    const { body } = renderBanner(config({ copy: { title: '<img src=x onerror=1>', acceptLabel: '"&\'', categoryLabels: { marketing: '<b>' } } }));
    expect(body).toContain('&lt;img src=x onerror=1&gt;');
    expect(body).toContain('&quot;&amp;&#39;');
    expect(body).toContain('&lt;b&gt;');
    expect(body).not.toContain('<img');
  });

  test('links: only safe hrefs render; the secondary link needs a label', () => {
    const body = (copy: object) => renderBanner(config({ copy })).body;
    expect(body({})).not.toContain('jini-consent-links');
    expect(body({ privacyPolicyUrl: '/privacy' })).toContain('<p class="jini-consent-links"><a href="/privacy">Privacy policy</a></p>');
    expect(body({ privacyPolicyUrl: 'javascript:alert(1)' })).not.toContain('<a ');
    expect(body({ secondaryLinkUrl: '/terms' })).not.toContain('<a ');
    expect(body({ privacyPolicyUrl: '/p', secondaryLinkUrl: 'https://example.com/t?a=1&b=2', secondaryLinkLabel: 'Terms' }))
      .toContain('<a href="/p">Privacy policy</a> · <a href="https://example.com/t?a=1&amp;b=2">Terms</a>');
  });

  test('owner CSS problems come back with the render, and bad rules do not reach the page', () => {
    const out = renderBanner(config(), { customCss: '#jini-consent h2{font-size:18px} body{display:none}', appearance: { borderRadius: '4px' } });
    expect(out.problems.map(p => p.code)).toEqual(['selector']);
    expect(out.head).toContain('#jini-consent h2{font-size:18px}');
    expect(out.head).toContain('border-radius:4px');
    expect(out.head).not.toContain('body{display:none}');
  });
});

describe('preview', () => {
  test('scriptless, open, with the htmlAttrs standing in for the client', () => {
    const out = renderBanner(config(), { clientSrc: '/c.js', preview: { region: 'opt-out', panel: true } });
    expect(out.head).not.toContain('<script src');
    expect(out.htmlAttrs).toBe('data-consent="pending" data-consent-region="opt-out" data-consent-open');
    expect(out.body).toContain(' data-preview>');
    expect(out.body).not.toMatch(/data-evidence="local" hidden/);
    expect(out.body).toContain('<details open>');
    expect(out.body).not.toContain('jini-consent-reopen');
  });

  test('any region other than opt-out previews as opt-in; the panel is closed by default', () => {
    const out = renderBanner(config(), { preview: { region: 'opt-in' } });
    expect(out.htmlAttrs).toContain('data-consent-region="opt-in"');
    expect(out.body).toContain('<details>');
    expect(renderBanner(config({ mode: 'headless' }), { preview: { region: 'opt-out' } }).htmlAttrs).toContain('opt-out');
  });
});

describe('safeHref', () => {
  test('local paths and https only', () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref('/privacy#a')).toBe('/privacy#a');
    expect(safeHref('https://example.com/p')).toBe('https://example.com/p');
    for (const bad of ['//evil.com', '/a b', '/a\\b', 'http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.com', 'privacy', 'mailto:a@b.c']) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe('resolveCopy', () => {
  test('owner strings override defaults; non-strings fall back; secondary link is optional', () => {
    expect(resolveCopy()).toEqual({ ...DEFAULT_COPY });
    const copy = resolveCopy({ title: 'Hi', message: 5 as never, secondaryLinkLabel: 'T', secondaryLinkUrl: 7 as never, categoryLabels: { analytics: 'Stats', marketing: null as never } });
    expect(copy.title).toBe('Hi');
    expect(copy.message).toBe(DEFAULT_COPY.message);
    expect(copy.secondaryLinkLabel).toBe('T');
    expect('secondaryLinkUrl' in copy).toBe(false);
    expect(copy.categoryLabels).toEqual({ ...DEFAULT_COPY.categoryLabels, analytics: 'Stats' });
  });
});

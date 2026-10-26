import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { injectBrowserAnalytics, renderBrowserAnalytics, resolveBrowserAnalyticsMode, type BrowserAnalyticsContribution } from '../product/browser.js';

const contribution: BrowserAnalyticsContribution = { supportsStatic: false, origins: ['https://collector.example'],
  source: 'function(){window.created++;return function(mode){window.modes.push(mode);};}' };

function bridge({ surface = 'site', choice, gpc = false }: { surface?: 'site' | 'admin'; choice?: { hasChoice: boolean; analytics: boolean }; gpc?: boolean } = {}) {
  const listeners = new Map<string, (event: { detail: unknown }) => void>();
  const window = { created: 0, modes: [] as string[], jiniConsent: choice,
    addEventListener: (name: string, callback: (event: { detail: unknown }) => void) => listeners.set(name, callback) };
  const html = renderBrowserAnalytics({ contributions: [contribution], surface, delivery: 'live', ...(surface === 'admin' ? { consent: choice } : {}) });
  runInNewContext(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>')), { window, navigator: { globalPrivacyControl: gpc } });
  return { window, update: (detail: unknown) => listeners.get(surface === 'site' ? 'jini:consent-changed' : 'jini:metrics-consent-changed')!({ detail }) };
}

describe('the existing consent choice selects browser mode', () => {
  it.each([
    [{ hasChoice: false, analytics: false }, 'pending'],
    [{ hasChoice: false, analytics: true }, 'pending'],
    [{ hasChoice: true, analytics: false }, 'anonymous'],
    [{ hasChoice: true, analytics: true }, 'full'],
    [{ hasChoice: true, analytics: true, gpc: true }, 'anonymous'],
  ] as const)('maps %j to %s', (input, expected) => expect(resolveBrowserAnalyticsMode(input)).toBe(expected));

  it('does not create a provider until a choice, then changes mode without a second factory', () => {
    const b = bridge();
    expect(b.window.created).toBe(0);
    b.update({ hasChoice: true, analytics: true });
    b.update({ hasChoice: true, analytics: false });
    b.update({ hasChoice: true, analytics: true, gpc: true });
    expect(b.window.created).toBe(1);
    expect(b.window.modes).toEqual(['full', 'anonymous', 'anonymous']);
  });

  it('navigator GPC overrides a previously saved grant', () => {
    const b = bridge({ choice: { hasChoice: true, analytics: true }, gpc: true });
    expect(b.window.modes).toEqual(['anonymous']);
  });

  it('admin metrics off is off, and revocation stops an existing controller', () => {
    const b = bridge({ surface: 'admin', choice: { hasChoice: false, analytics: false } });
    expect(b.window.created).toBe(0);
    b.update(true); b.update(false);
    expect(b.window.modes).toEqual(['full', 'pending']);
  });
});

it('injects once, before body end, and excludes unsupported static contributions', () => {
  const input = { html: '<html><body>site</body></html>', contributions: [contribution], surface: 'site' as const, delivery: 'live' as const };
  const html = injectBrowserAnalytics(input);
  expect(html.indexOf('data-jini-browser-analytics')).toBeLessThan(html.indexOf('</body>'));
  expect(injectBrowserAnalytics({ ...input, html })).toBe(html);
  expect(injectBrowserAnalytics({ ...input, delivery: 'static' })).toBe(input.html);
  expect(injectBrowserAnalytics({ ...input, contributions: [] })).toBe(input.html);
  expect(injectBrowserAnalytics({ ...input, delivery: 'static', contributions: [{ ...contribution, supportsStatic: true }] })).toContain('data-jini-browser-analytics');
});

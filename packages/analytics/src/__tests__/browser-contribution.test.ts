import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { injectBrowserAnalytics, renderBrowserAnalytics, resolveBrowserAnalyticsMode, type BrowserAnalyticsContribution } from '../product/browser.js';

const contribution: BrowserAnalyticsContribution = { supportsStatic: false, origins: ['https://collector.example'],
  source: 'function(){window.created++;return function(mode){window.modes.push(mode);};}' };

function bridge({ surface = 'site', choice, gpc = false, configuration, request = async () => ({ ok: true, json: async () => ['current'] }) }: {
  surface?: 'site' | 'admin'; choice?: { hasChoice: boolean; analytics: boolean }; gpc?: boolean;
  configuration?: BrowserAnalyticsContribution['configuration'];
  request?: () => Promise<{ ok: boolean; json: () => Promise<string[]> }>;
} = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const writes: [string, string][] = [], broadcasts: unknown[] = [], checks: (() => void)[] = [];
  let receive!: (event: { data: unknown }) => void;
  const window = { created: 0, modes: [] as string[], jiniConsent: choice, jiniBrowserAnalyticsLive: true,
    localStorage: { setItem: (key: string, value: string) => { writes.push([key, value]); } },
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback) };
  const html = renderBrowserAnalytics({ contributions: [{ ...contribution, ...(configuration ? { configuration } : {}) }], surface, delivery: 'live', ...(surface === 'admin' ? { consent: choice } : {}) });
  runInNewContext(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>')), {
    window, navigator: { globalPrivacyControl: gpc }, fetch: request,
    AbortSignal: { timeout: () => undefined }, setInterval: (check: () => void) => { checks.push(check); return 1; }, clearInterval() {},
    BroadcastChannel: class {
      set onmessage(callback: typeof receive) { receive = callback; }
      postMessage(state: unknown) { broadcasts.push(state); }
    },
  });
  return { window, writes, broadcasts, check: () => checks.forEach(check => check()),
    storage: (key: string | null, newValue: string | null) => listeners.get('storage')!({ key, newValue }),
    broadcast: (data: unknown) => receive({ data }),
    update: (detail: unknown) => listeners.get(surface === 'site' ? 'jini:consent-changed' : 'jini:metrics-consent-changed')!({ detail }) };
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

it('withdraws admin metrics across tabs via storage and BroadcastChannel without accepting remote grants', () => {
  const choice = { hasChoice: true, analytics: true };
  const a = bridge({ surface: 'admin', choice }), b = bridge({ surface: 'admin', choice });
  a.update(false);
  expect(a.writes).toEqual([['jini:analytics-consent:admin', '{"hasChoice":false,"analytics":false}']]);
  b.storage(...a.writes[0]!);
  expect(b.window.modes).toEqual(['full', 'pending']);
  b.broadcast({ hasChoice: true, analytics: true });
  expect(b.window.modes).toEqual(['full', 'pending']);
  b.update(true);
  b.broadcast(a.broadcasts[0]);
  expect(b.window.modes).toEqual(['full', 'pending', 'full', 'pending']);
});

it('site withdrawal switches the other document to anonymous and ignores unrelated storage', () => {
  const b = bridge({ choice: { hasChoice: true, analytics: true } });
  b.storage('unrelated', '{}');
  expect(b.window.modes).toEqual(['full']);
  b.storage('jini:analytics-consent:site', '{"hasChoice":true,"analytics":false}');
  expect(b.window.modes).toEqual(['full', 'anonymous']);
  b.storage(null, null);
  expect(b.window.modes).toEqual(['full', 'anonymous', 'pending']);
});

it('a changed provider configuration retires controllers permanently until reload', async () => {
  let revisions = ['current'];
  const b = bridge({ choice: { hasChoice: true, analytics: true }, configuration: { url: '/configuration', revision: 'current' },
    request: async () => ({ ok: true, json: async () => revisions }) });
  // VM checks await host promises across realms; let them settle before polling or asserting.
  await setImmediate();
  expect(b.window.modes).toEqual(['full']);
  revisions = ['replacement']; b.check();
  await setImmediate();
  expect(b.window.modes).toEqual(['full', 'pending']);
  expect(b.window.jiniBrowserAnalyticsLive).toBe(false);
  b.update({ hasChoice: true, analytics: true });
  expect(b.window.modes).toEqual(['full', 'pending']);
});

it('configuration-check failure stops browser analytics instead of keeping stale credentials active', async () => {
  const b = bridge({ surface: 'admin', choice: { hasChoice: true, analytics: true }, configuration: { url: '/configuration', revision: 'current' },
    request: async () => { throw new Error('offline'); } });
  await setImmediate();
  expect(b.window.modes).toEqual(['full', 'pending']);
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

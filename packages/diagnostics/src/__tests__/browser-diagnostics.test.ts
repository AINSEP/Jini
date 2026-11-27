import { describe, expect, it } from 'vitest';
import type { ObservabilityPort } from '@jini-ai/core/contracts/observability';
import type { SettingsRepoPort } from '@jini-ai/core/settings';
import { browserDiagnosticsEnabled, receiveBrowserDiagnostics, siteBrowserDiagnosticsBridge, siteBrowserDiagnosticsModule } from '../browser-diagnostics.js';

describe('site browser diagnostics module', () => {
  it('site diagnostics waits for full consent, reports one buffered navigation and error codes, and disposes', () => {
    const bridge = new Function(siteBrowserDiagnosticsModule.replace('export default', 'return'))();
    const sent: { body: string; signal: AbortSignal }[] = [];
    let notify!: (state: { analyticsLevel: string }) => void;
    let observe!: (list: { getEntries(): { duration: number }[] }) => void;
    let observers = 0, disconnected = 0, unsubscribed = 0;
    const target = Object.assign(new EventTarget(), { AbortController,
      PerformanceObserver: class {
        constructor(callback: typeof observe) { observe = callback; observers++; }
        observe(options: unknown) { expect(options).toEqual({ type: 'navigation', buffered: true }); }
        disconnect() { disconnected++; }
      },
      fetch: (url: string, input: { body: string; signal: AbortSignal }) => { expect(url).toBe('/_jini/browser-analytics/site/diagnostics'); sent.push(input); return Promise.reject(new Error('offline')); },
    });
    const api = { get: () => ({ analyticsLevel: 'none' }), subscribe: ({ listener }: { listener: typeof notify }) => { notify = listener; return () => { unsubscribed++; }; } };
    const unmount = bridge.mount({ api, doc: { defaultView: target } });
    target.dispatchEvent(new Event('error'));
    expect(observers).toBe(0); expect(sent.length, 'nothing is sent before full consent').toBe(0);
    notify({ analyticsLevel: 'full' }); notify({ analyticsLevel: 'full' });
    expect(observers).toBe(1);
    observe({ getEntries: () => [{ duration: 0 }, { duration: 12 }, { duration: 34 }] });
    observe({ getEntries: () => [{ duration: 56 }] });
    target.dispatchEvent(new Event('error')); target.dispatchEvent(new Event('unhandledrejection'));
    expect(sent.map(input => JSON.parse(input.body))).toEqual([{ navigationMs: 12 }, { errorKind: 1 }, { errorKind: 2 }]);
    notify({ analyticsLevel: 'anonymous' });
    expect(disconnected).toBe(2); expect(sent.every(input => input.signal.aborted)).toBe(true);
    target.dispatchEvent(new Event('error')); target.dispatchEvent(new Event('unhandledrejection'));
    expect(sent.length).toBe(3);
    unmount(); expect(unsubscribed).toBe(1);
    const unmountFull = bridge.mount({ api: { ...api, get: () => ({ analyticsLevel: 'full' }) }, doc: { defaultView: target } });
    expect(observers).toBe(2);
    unmountFull(); target.dispatchEvent(new Event('error'));
    expect(disconnected).toBe(3); expect(unsubscribed).toBe(2); expect(sent.length).toBe(3);
  });
});

const CONSENT = { namespace: 'host.privacy', key: 'telemetry.metrics' };

function harness({ consent, supportsMetric = true, failRead = false }: { consent: unknown; supportsMetric?: boolean; failRead?: boolean }) {
  const reads: { namespace: string; key: string }[] = [];
  const metrics: unknown[] = [];
  const settingsRepo = {
    findActiveDefinition: async ({ namespace, key }: { namespace: string; key: string }) => {
      reads.push({ namespace, key });
      if (failRead) throw new Error('db down');
      return consent === undefined ? null : { settingId: 's1', namespace, key, version: 1, defaultValue: consent };
    },
    getWorkspaceValue: async () => null,
    getGlobalValue: async () => null,
  } as unknown as SettingsRepoPort;
  const observability = { supportsMetric, metric: async (input: unknown, options: unknown) => { metrics.push([input, options]); } } as unknown as ObservabilityPort;
  return { reads, metrics, deps: { settingsRepo, workspaceId: 'w1', observability, consentSetting: CONSENT } };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('browser diagnostics enablement and intake', () => {
  it('accepts the exact navigation ceiling and rejects nonpositive, infinite, and nonnumeric inputs', async () => {
    const on = harness({ consent: true });
    const send = (raw: string, contentType = 'application/json') =>
      receiveBrowserDiagnostics({ body: new TextEncoder().encode(raw), contentType }, { deps: on.deps });
    for (const raw of ['null', 'false', '{"navigationMs":0}', '{"navigationMs":-1}', '{"navigationMs":1e999}', '{"navigationMs":"42"}']) {
      expect(await send(raw), raw).toEqual({ status: 400, body: '' });
    }
    expect(on.metrics).toEqual([]);
    expect(await send('{"navigationMs":600000}', '  Application/JSON  ; charset=utf-8')).toEqual({ status: 204, body: '' });
    expect(on.metrics).toEqual([
      [{ name: 'browser.navigation.duration', value: 600_000 }, { kind: 'histogram', unit: 'ms', attributes: { surface: 'site' } }],
    ]);
  });

  it('is off without metric admission, settings or workspace, and on only for an explicit true of the injected setting', async () => {
    const on = harness({ consent: true });
    expect(await browserDiagnosticsEnabled({ observability: on.deps.observability, consentSetting: CONSENT }, on.deps)).toBe(true);
    expect(on.reads.every((read) => read.namespace === CONSENT.namespace && read.key === CONSENT.key) && on.reads.length > 0, 'reads the injected setting').toBe(true);
    expect(await browserDiagnosticsEnabled({ observability: on.deps.observability, consentSetting: CONSENT })).toBe(false);
    expect(await browserDiagnosticsEnabled({ observability: harness({ consent: true, supportsMetric: false }).deps.observability, consentSetting: CONSENT }, on.deps)).toBe(false);
    for (const consent of [false, 'true', undefined]) {
      const off = harness({ consent });
      expect(await browserDiagnosticsEnabled({ observability: off.deps.observability, consentSetting: CONSENT }, off.deps)).toBe(false);
    }
    const broken = harness({ consent: true, failRead: true });
    expect(await browserDiagnosticsEnabled({ observability: broken.deps.observability, consentSetting: CONSENT }, broken.deps)).toBe(false);
  });

  it('admits one bounded JSON entry as a fixed-name metric and refuses everything else by status', async () => {
    const off = harness({ consent: false });
    expect(await receiveBrowserDiagnostics({ body: json({ navigationMs: 5 }), contentType: 'application/json' }, { deps: off.deps })).toEqual({ status: 404, body: '' });
    const on = harness({ consent: true });
    const send = (body: Uint8Array, contentType = 'application/json; charset=utf-8') => receiveBrowserDiagnostics({ body, contentType }, { deps: on.deps });
    expect((await send(json({ navigationMs: 5 }), 'text/plain')).status).toBe(415);
    expect((await send(new Uint8Array(257))).status).toBe(413);
    expect((await send(new TextEncoder().encode('{'))).status).toBe(400);
    expect((await send(json({ navigationMs: 5, errorKind: 1 }))).status).toBe(400);
    expect((await send(json({ navigationMs: 600_001 }))).status).toBe(400);
    expect((await send(json({ errorKind: 3 }))).status).toBe(400);
    expect((await send(json({ navigationMs: 42 }))).status).toBe(204);
    expect((await send(json({ errorKind: 1 }))).status).toBe(204);
    expect((await send(json({ errorKind: 2 }))).status).toBe(204);
    expect(on.metrics).toEqual([
      [{ name: 'browser.navigation.duration', value: 42 }, { kind: 'histogram', unit: 'ms', attributes: { surface: 'site' } }],
      [{ name: 'browser.error', value: 1 }, { kind: 'counter', attributes: { surface: 'site' } }],
      [{ name: 'browser.unhandled_rejection', value: 1 }, { kind: 'counter', attributes: { surface: 'site' } }],
    ]);
    expect(siteBrowserDiagnosticsBridge.src).toBe('/_jini/browser-analytics/site/diagnostics.js');
  });
});

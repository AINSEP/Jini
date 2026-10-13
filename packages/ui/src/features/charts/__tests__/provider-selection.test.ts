import { describe, expect, it } from 'vitest';
import { createChartProviderRegistry, selectChartProviders, type ChartProviderEntry, type ChartSpec } from '../index.js';
import { loadChartProvider, mountChart } from '../browser.js';

const spec: ChartSpec = { kind: 'bar', data: [{ name: '<script>oops</script>', value: 2 }], categoryKey: 'name', series: [{ key: 'value' }] };
function provider(id: string, kinds = ['bar'], enabled = true): ChartProviderEntry {
  return { id, kinds, enabled, load: async () => ({ mount: () => ({ update() {}, destroy() {} }) }) };
}

describe('registry-owned chart preference and browser fallback', () => {
  it('orders override, site default, then supported enabled providers in registry order', () => {
    const registry = createChartProviderRegistry({ providers: [provider('a'), provider('b'), provider('disabled', ['bar'], false), provider('pie', ['pie']), provider('c')] });
    expect(selectChartProviders({ registry, spec: { ...spec, provider: 'c' } }, { siteProvider: 'b' }).map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    expect(selectChartProviders({ registry, spec: { ...spec, provider: 'disabled' } }, { siteProvider: 'pie' }).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(selectChartProviders({ registry, spec: { ...spec, kind: 'heatmap' } })).toEqual([]);
  });

  it('keeps a safe table visible during loading, advances after failure and destroys the successful mount', async () => {
    let resolve!: (value: { mount: () => never }) => void;
    const loading = new Promise<{ mount: () => never }>((done) => { resolve = done; });
    const events: string[] = [];
    const registry = createChartProviderRegistry({ providers: [
      { ...provider('bad'), load: () => loading },
      { ...provider('good'), load: async () => ({ mount: ({ element }) => {
        element.textContent = 'Chart';
        return { update() {}, destroy() { events.push('destroy'); } };
      } }) },
    ] });
    const element = document.createElement('div');
    const chart = mountChart({ element, spec, registry });
    expect(element.querySelector('table')?.textContent).toContain('<script>oops</script>');
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(false);
    resolve({ mount: () => { throw new Error('render failed'); } });
    await chart.ready;
    expect(element.querySelector('[data-chart-renderer]')?.textContent).toBe('Chart');
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(true);
    chart.destroy({});
    expect(events).toEqual(['destroy']);
    expect(element.children).toHaveLength(0);
  });

  it('destroys a failed update and returns to the table when providers are exhausted', async () => {
    let destroyed = 0;
    const registry = createChartProviderRegistry({ providers: [{ ...provider('broken'), load: async () => ({ mount: () => ({
      update() { throw new Error('update failed'); }, destroy() { destroyed++; },
    }) }) }] });
    const element = document.createElement('div');
    const chart = mountChart({ element, spec, registry });
    await chart.ready;
    await chart.update({ spec: { ...spec, data: [{ name: 'New', value: 9 }] } });
    expect(destroyed).toBe(1);
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(false);
    expect(element.querySelector('table')?.textContent).toContain('New9');
    chart.destroy({});
  });

  it('ignores late loads after destroy and supports provider-defined kinds', async () => {
    let resolve!: (value: { mount: () => never }) => void;
    let mounted = 0;
    const registry = createChartProviderRegistry({ providers: [{ ...provider('calendar', ['calendar']), load: () => new Promise((done) => { resolve = done; }) }] });
    const chart = mountChart({ element: document.createElement('div'), spec: { ...spec, kind: 'calendar' }, registry });
    chart.destroy({});
    resolve({ mount: () => { mounted++; throw new Error('late'); } });
    await chart.ready;
    expect(mounted).toBe(0);
  });
});

it('cleans up after a post-mount renderer error and advances to the next provider', async () => {
  let fail!: (error: unknown) => void;
  const events: string[] = [];
  const registry = createChartProviderRegistry({ providers: [
    { ...provider('first'), load: async () => ({ mount: (_input, options) => {
      fail = options!.onError!;
      return { update() {}, destroy() { events.push('first destroyed'); } };
    } }) },
    { ...provider('second'), load: async () => ({ mount: ({ element }) => {
      element.textContent = 'Recovered'; events.push('second mounted'); return { update() {}, destroy() {} };
    } }) },
  ] });
  const element = document.createElement('div'); const chart = mountChart({ element, spec, registry });
  await chart.ready; fail(new Error('late commit failure'));
  // Flush the real promise/microtask lifecycle (no timers or module replacement).
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(events).toEqual(['first destroyed', 'second mounted']);
  expect(element.querySelector('[data-chart-renderer]')?.textContent).toBe('Recovered');
  chart.destroy({});
});

it('lets newer updates remain authoritative when an older update fails late', async () => {
  const updates: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  let destroys = 0;
  const registry = createChartProviderRegistry({ providers: [{ ...provider('async'), load: async () => ({ mount: () => ({
    update: () => new Promise<void>((resolve, reject) => { updates.push({ resolve, reject }); }), destroy() { destroys++; },
  }) }) }] });
  const element = document.createElement('div'); const chart = mountChart({ element, spec, registry });
  await chart.ready;
  const older = chart.update({ spec: { ...spec, data: [{ name: 'Old', value: 1 }] } });
  const newer = chart.update({ spec: { ...spec, data: [{ name: 'New', value: 9 }] } });
  updates[1]!.resolve(); await newer;
  updates[0]!.reject(new Error('stale update failed')); await older;
  expect(destroys).toBe(0);
  expect(element.querySelector('table')?.textContent).toContain('New9');
  expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(true);
  chart.destroy({});
});

it('loads admitted provider modules through an injected native-import seam', async () => {
  const urls: string[] = [];
  const module = { mount: () => ({ update() {}, destroy() {} }) };
  expect(await loadChartProvider({ url: '/verified/provider.js' }, { importModule: async ({ url }) => { urls.push(url); return module; } })).toBe(module);
  expect(urls).toEqual(['/verified/provider.js']);
  await expect(loadChartProvider({ url: '/bad.js' }, { importModule: async () => ({}) })).rejects.toThrow('Chart provider must export mount.');
});

it('preserves fallback recovery when a host diagnostic callback fails', async () => {
  let destroyed = 0;
  const registry = createChartProviderRegistry({ providers: [{ ...provider('bad'), load: async () => ({ mount: () => ({
    ready: Promise.reject(new Error('first render failed')), update() {}, destroy() { destroyed++; },
  }) }) }] });
  const element = document.createElement('div');
  const chart = mountChart({ element, spec, registry }, { onProviderError: () => { throw new Error('diagnostic failed'); } });
  await chart.ready;
  expect(destroyed).toBe(1);
  expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(false);
  chart.destroy({});
});

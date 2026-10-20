import { describe, expect, it, vi } from 'vitest';
import { mountChart, type MountChartOptions } from '../browser.js';
import { createChartProviderRegistry } from '../registry.js';
import { DEFAULT_CHART_THEME, type ChartInstance, type ChartMountOptions, type ChartProvider, type ChartProviderEntry, type ChartSpec } from '../contract.js';

const spec: ChartSpec = { kind: 'bar', data: [{ label: 'Old', value: 1 }], series: [{ key: 'value' }] };
const nextSpec: ChartSpec = { ...spec, data: [{ label: 'New', value: 9 }] };

function deferred<T>(_input: Record<string, never>, _options: Record<string, never> = {}) {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function provider({ id, mount }: { id: string; mount: ChartProvider['mount'] }, _options: Record<string, never> = {}): ChartProviderEntry {
  return { id, kinds: ['bar'], enabled: true, load: async () => ({ mount }) };
}

function host({ providers }: { providers: ChartProviderEntry[] }, options: MountChartOptions = {}) {
  const element = document.createElement('div');
  const registry = createChartProviderRegistry({ providers });
  const chart = mountChart({ element, spec, registry }, options);
  const fallback = element.querySelector<HTMLElement>('[data-chart-fallback]')!;
  const renderer = element.querySelector<HTMLElement>('[data-chart-renderer]')!;
  return { element, chart, fallback, renderer };
}

describe('chart browser lifecycle characterization', () => {
  it('keeps the table until ready, reuses the provider on update and retains the latest theme', async () => {
    const firstRender = deferred<void>({});
    const mounted = deferred<void>({});
    const update = vi.fn<ChartInstance['update']>();
    const destroy = vi.fn<ChartInstance['destroy']>();
    const mount = vi.fn<ChartProvider['mount']>(({ element, theme }) => {
      expect(theme).toBe(DEFAULT_CHART_THEME);
      element.textContent = 'Chart'; mounted.resolve();
      return { ready: firstRender.promise, update, destroy };
    });
    const view = host({ providers: [provider({ id: 'first', mount })] });
    await mounted.promise;
    expect(view.fallback.hidden).toBe(false);
    expect(view.renderer.textContent).toBe('Chart');
    firstRender.resolve(); await view.chart.ready;
    expect(view.fallback.hidden).toBe(true);
    const theme = { mode: 'dark' as const, tokens: { '--jini-chart-accent': 'red' } };
    await view.chart.update({ spec: nextSpec, theme });
    await view.chart.update({ spec });
    expect(update.mock.calls).toEqual([[{ spec: nextSpec, theme }], [{ spec, theme }]]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(view.element.dataset.chartTheme).toBe('dark');
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({}); view.chart.destroy({});
    await view.chart.update({ spec: nextSpec });
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(view.element.children).toHaveLength(0);
  });

  it.each(['load', 'mount', 'ready'] as const)('reports a live %s failure and advances despite diagnostic or destroy errors', async (phase) => {
    const error = new Error(phase);
    const cleanupError = new Error('cleanup');
    const reports: { provider: string; error: unknown }[] = [];
    const destroy = vi.fn(() => { throw cleanupError; });
    const failedMount = vi.fn<ChartProvider['mount']>(() => {
      if (phase === 'mount') throw error;
      return { ready: Promise.reject(error), update() {}, destroy };
    });
    const first: ChartProviderEntry = { ...provider({ id: 'first', mount: failedMount }), load: async () => {
      if (phase === 'load') throw error;
      return { mount: failedMount };
    } };
    const loadSecond = vi.fn(async (): Promise<ChartProvider> => ({ mount: ({ element }) => {
      element.textContent = 'Recovered'; return { update() {}, destroy() {} };
    } }));
    const view = host({ providers: [first, { ...provider({ id: 'second', mount: () => ({ update() {}, destroy() {} }) }), load: loadSecond }] }, {
      onProviderError(report) { reports.push(report); throw new Error('diagnostic'); },
    });
    await view.chart.ready;
    expect(reports).toEqual(phase === 'ready' ? [{ provider: 'first', error }, { provider: 'first', error: cleanupError }] : [{ provider: 'first', error }]);
    expect(destroy).toHaveBeenCalledTimes(phase === 'ready' ? 1 : 0);
    expect(view.renderer.textContent).toBe('Recovered');
    expect(view.fallback.hidden).toBe(true);
    expect(loadSecond.mock.calls).toEqual([[{}]]);
    view.chart.destroy({});
  });

  it('keeps an exhausted table usable and mounts a newly supported provider on a later update', async () => {
    const mount = vi.fn<ChartProvider['mount']>(({ element }) => {
      element.textContent = 'Line chart'; return { update() {}, destroy() {} };
    });
    const view = host({ providers: [{ ...provider({ id: 'line', mount }), kinds: ['line'] }] });
    await view.chart.ready;
    expect(view.fallback.hidden).toBe(false);
    expect(view.renderer.children).toHaveLength(0);
    await view.chart.update({ spec: { ...nextSpec, kind: 'line' } });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(view.renderer.textContent).toBe('Line chart');
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({});
  });

  it.each(['resolve', 'reject'] as const)('ignores a late load that %ss after destruction', async (outcome) => {
    const loading = deferred<ChartProvider>({});
    const mount = vi.fn<ChartProvider['mount']>(() => ({ update() {}, destroy() {} }));
    const onProviderError = vi.fn();
    const view = host({ providers: [{ ...provider({ id: 'first', mount }), load: () => loading.promise }] }, { onProviderError });
    view.chart.destroy({});
    if (outcome === 'resolve') loading.resolve({ mount }); else loading.reject(new Error('late load'));
    await view.chart.ready;
    expect(mount).not.toHaveBeenCalled();
    expect(onProviderError).not.toHaveBeenCalled();
    expect(view.element.children).toHaveLength(0);
  });

  it.each(['resolve', 'reject'] as const)('ignores a superseded load that %ss while a newer mount is loading', async (outcome) => {
    const oldLoad = deferred<ChartProvider>({});
    const newLoad = deferred<ChartProvider>({});
    const mount = vi.fn<ChartProvider['mount']>(({ element, spec: current }) => {
      element.textContent = String(current.data[0]!.label); return { update() {}, destroy() {} };
    });
    const load = vi.fn<ChartProviderEntry['load']>().mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise);
    const onProviderError = vi.fn();
    const view = host({ providers: [{ ...provider({ id: 'first', mount }), load }] }, { onProviderError });
    const updating = view.chart.update({ spec: nextSpec });
    if (outcome === 'resolve') oldLoad.resolve({ mount }); else oldLoad.reject(new Error('superseded'));
    await view.chart.ready;
    expect(mount).not.toHaveBeenCalled();
    expect(view.fallback.hidden).toBe(false);
    expect(onProviderError).not.toHaveBeenCalled();
    newLoad.resolve({ mount }); await updating;
    expect(mount.mock.calls[0]![0].spec).toBe(nextSpec);
    expect(view.renderer.textContent).toBe('New');
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({});
  });

  it.each(['resolve', 'reject'] as const)('ignores first-render %s after a newer revision starts updating the same instance', async (outcome) => {
    const firstRender = deferred<void>({});
    const mounted = deferred<void>({});
    const update = deferred<void>({});
    const destroy = vi.fn();
    const onProviderError = vi.fn();
    const view = host({ providers: [provider({ id: 'first', mount: () => {
      mounted.resolve(); return { ready: firstRender.promise, update: () => update.promise, destroy };
    } })] }, { onProviderError });
    await mounted.promise;
    const updating = view.chart.update({ spec: nextSpec });
    if (outcome === 'resolve') firstRender.resolve(); else firstRender.reject(new Error('stale first render'));
    await view.chart.ready;
    expect(view.fallback.hidden).toBe(false);
    expect(view.fallback.querySelector('tbody')?.textContent).toBe('9New');
    expect(destroy).not.toHaveBeenCalled();
    expect(onProviderError).not.toHaveBeenCalled();
    update.resolve(); await updating;
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({});
  });

  it.each(['resolve', 'reject'] as const)('ignores first-render %s after its instance is destroyed', async (outcome) => {
    const firstRender = deferred<void>({});
    const mounted = deferred<void>({});
    const destroy = vi.fn();
    const onProviderError = vi.fn();
    const view = host({ providers: [provider({ id: 'first', mount: () => {
      mounted.resolve(); return { ready: firstRender.promise, update() {}, destroy };
    } })] }, { onProviderError });
    await mounted.promise; view.chart.destroy({});
    if (outcome === 'resolve') firstRender.resolve(); else firstRender.reject(new Error('late first render'));
    await view.chart.ready;
    expect(view.fallback.hidden).toBe(false);
    expect(view.element.children).toHaveLength(0);
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(onProviderError).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores first-render %s after replacement by a preferred provider', async (outcome) => {
    const firstRender = deferred<void>({});
    const mounted = deferred<void>({});
    const destroy = vi.fn();
    const onProviderError = vi.fn();
    const view = host({ providers: [
      provider({ id: 'first', mount: () => { mounted.resolve(); return { ready: firstRender.promise, update() {}, destroy }; } }),
      provider({ id: 'second', mount: ({ element }) => { element.textContent = 'Second'; return { update() {}, destroy() {} }; } }),
    ] }, { onProviderError });
    await mounted.promise;
    await view.chart.update({ spec: { ...nextSpec, provider: 'second' } });
    if (outcome === 'resolve') firstRender.resolve(); else firstRender.reject(new Error('replaced first render'));
    await view.chart.ready;
    expect(view.renderer.textContent).toBe('Second');
    expect(view.fallback.hidden).toBe(true);
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(onProviderError).not.toHaveBeenCalled();
    view.chart.destroy({});
  });

  it.each(['resolve', 'reject'] as const)('ignores a stale update that %ss while a newer revision is pending', async (outcome) => {
    const oldUpdate = deferred<void>({});
    const newUpdate = deferred<void>({});
    const update = vi.fn<ChartInstance['update']>().mockReturnValueOnce(oldUpdate.promise).mockReturnValueOnce(newUpdate.promise);
    const destroy = vi.fn();
    const onProviderError = vi.fn();
    const view = host({ providers: [provider({ id: 'first', mount: () => ({ update, destroy }) })] }, { onProviderError });
    await view.chart.ready;
    const older = view.chart.update({ spec });
    const newer = view.chart.update({ spec: nextSpec });
    if (outcome === 'resolve') oldUpdate.resolve(); else oldUpdate.reject(new Error('stale update'));
    await older;
    expect(view.fallback.hidden).toBe(false);
    expect(view.fallback.querySelector('tbody')?.textContent).toBe('9New');
    expect(destroy).not.toHaveBeenCalled();
    expect(onProviderError).not.toHaveBeenCalled();
    newUpdate.resolve(); await newer;
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({});
  });

  it.each(['resolve', 'reject'] as const)('ignores a pending update that %ss after destruction', async (outcome) => {
    const pending = deferred<void>({});
    const destroy = vi.fn();
    const onProviderError = vi.fn();
    const view = host({ providers: [provider({ id: 'first', mount: () => ({ update: () => pending.promise, destroy }) })] }, { onProviderError });
    await view.chart.ready;
    const updating = view.chart.update({ spec: nextSpec });
    view.chart.destroy({});
    if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('late update'));
    await updating;
    expect(view.fallback.hidden).toBe(false);
    expect(view.element.children).toHaveLength(0);
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(onProviderError).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores an update that %ss after an async renderer error replaces its instance', async (outcome) => {
    const pending = deferred<void>({});
    const secondMounted = deferred<void>({});
    let firstOptions: ChartMountOptions | undefined;
    const destroy = vi.fn();
    const reports: { provider: string; error: unknown }[] = [];
    const secondReady = deferred<void>({});
    const rendererError = new Error('renderer error');
    const view = host({ providers: [
      provider({ id: 'first', mount: (_input, options) => { firstOptions = options; return { update: () => pending.promise, destroy }; } }),
      provider({ id: 'second', mount: ({ element }) => { element.textContent = 'Second'; secondMounted.resolve(); return { ready: secondReady.promise, update() {}, destroy() {} }; } }),
    ] }, { onProviderError(report) { reports.push(report); } });
    await view.chart.ready;
    const updating = view.chart.update({ spec: nextSpec });
    firstOptions!.onError!(rendererError);
    await secondMounted.promise;
    if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('replaced update'));
    await updating;
    expect(view.renderer.textContent).toBe('Second');
    expect(view.fallback.hidden).toBe(false);
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(reports).toEqual([{ provider: 'first', error: rendererError }]);
    secondReady.resolve(); await secondReady.promise;
    expect(view.fallback.hidden).toBe(true);
    view.chart.destroy({});
  });

  it('blacklists an update failure, reports it once and leaves the newest data visible when exhausted', async () => {
    const error = new Error('update');
    const destroy = vi.fn();
    const mount = vi.fn<ChartProvider['mount']>(() => ({ update() { throw error; }, destroy }));
    const onProviderError = vi.fn();
    const view = host({ providers: [provider({ id: 'first', mount })] }, { onProviderError });
    await view.chart.ready;
    await view.chart.update({ spec: nextSpec });
    await view.chart.update({ spec: { ...nextSpec, provider: 'first' } });
    expect(destroy.mock.calls).toEqual([[{}]]);
    expect(onProviderError.mock.calls).toEqual([[{ provider: 'first', error }]]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(view.fallback.hidden).toBe(false);
    expect(view.fallback.querySelector('tbody')?.textContent).toBe('9New');
    expect(view.renderer.children).toHaveLength(0);
    view.chart.destroy({});
  });
});

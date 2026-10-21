import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { loadChartProvider, mountChart } from '../browser.js';
import type { ChartProviderEntry, ChartSpec } from '../contract.js';
import { ChartHost } from '../react.js';
import { createChartProviderRegistry, selectChartProviders } from '../registry.js';

const spec: ChartSpec = { kind: 'bar', data: [{ label: 'Jan', value: 2 }], series: [{ key: 'value' }] };

/** Real ES modules for the default native-import path, as `data:` URLs (a scheme Node's ESM loader accepts). */
const PROVIDER_MODULE = `data:text/javascript,${encodeURIComponent("export function mount({ element }) { element.textContent = 'fixture chart'; return { ready: Promise.resolve(), update() {}, destroy() {} }; }")}`;
const NOT_A_PROVIDER_MODULE = `data:text/javascript,${encodeURIComponent("export const name = 'not a chart provider';")}`;

describe('loadChartProvider default import', () => {
  it('natively imports a module URL and returns it when it exports mount', async () => {
    const provider = await loadChartProvider({ url: PROVIDER_MODULE });
    const element = document.createElement('div');
    provider.mount({ element, spec, theme: { mode: 'light', tokens: {} } }, { onError: () => {} });
    expect(element.textContent).toBe('fixture chart');
  });

  it('rejects a natively imported module that has no mount export', async () => {
    await expect(loadChartProvider({ url: NOT_A_PROVIDER_MODULE }))
      .rejects.toThrow('Chart provider must export mount.');
  });
});

describe('selectChartProviders capability probe', () => {
  it('keeps providers that declare no probe or accept the spec, and skips one that refuses it', () => {
    const entry = (id: string, supports?: ChartProviderEntry['supports']): ChartProviderEntry => ({
      id, kinds: ['bar'], enabled: true, load: async () => ({ mount: () => ({ update() {}, destroy() {} }) }), ...(supports ? { supports } : {}),
    });
    const registry = createChartProviderRegistry({ providers: [entry('open'), entry('accepts', () => true), entry('refuses', () => false)] });
    expect(selectChartProviders({ registry, spec }).map(({ id }) => id)).toEqual(['open', 'accepts']);
  });
});

describe('mountChart render errors', () => {
  it('ignores a render error reported by a mount that then throws, reporting the failure exactly once', async () => {
    const errors: string[] = [];
    const registry = createChartProviderRegistry({ providers: [{ id: 'flaky', kinds: ['bar'], enabled: true, load: async () => ({
      mount: (_input, { onError }) => { onError(new Error('async render failure')); throw new Error('mount failed'); },
    }) }] });
    const element = document.createElement('div');
    const chart = mountChart({ element, spec, registry }, { onProviderError: ({ provider, error }) => errors.push(`${provider}:${(error as Error).message}`) });
    await chart.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['flaky:mount failed']);
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')?.hidden).toBe(false);
  });
});

describe('ChartHost provider errors', () => {
  it('forwards a provider failure to the host diagnostic callback', async () => {
    const reported: string[] = [];
    const registry = createChartProviderRegistry({ providers: [{ id: 'broken', kinds: ['bar'], enabled: true, load: async () => { throw new Error('bundle missing'); } }] });
    const onProviderError = ({ provider }: { provider: string }) => { reported.push(provider); };
    const { container } = render(<ChartHost spec={spec} registry={registry} onProviderError={onProviderError} />);
    await waitFor(() => expect(reported).toEqual(['broken']));
    expect(container.querySelector('[data-chart-fallback]')).not.toBeNull();
  });
});

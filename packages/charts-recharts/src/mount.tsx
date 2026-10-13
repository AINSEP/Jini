/** Recharts owns one isolated React root inside the vanilla provider's assigned element. */
import { Component, useLayoutEffect, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChartInstance, ChartMountOptions, ChartRenderInput } from '@jini-ai/ui/charts';
import { applyChartTheme } from '@jini-ai/ui/charts/browser';
import { BarChart } from './bar-chart.js';
import { LineChart } from './line-chart.js';
import { PieChart } from './pie-chart.js';
import { supportsRechartsSpec } from './descriptor.js';

export class UnsupportedChartSpecError extends Error {
  constructor() { super('Unsupported Recharts chart specification.'); this.name = 'UnsupportedChartSpecError'; }
}

/** Catch render/commit errors inside this provider's root and report through the vanilla ABI.
 * Core owns the data table and recovery chain; the provider must not invent another fallback.
 */
class ProviderBoundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error): void { this.props.onError(error); }
  render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

/** Commit acknowledgement lets the framework-free host retain its table until rendering succeeds. */
function ProviderChart({ spec, onReady }: ChartRenderInput & { onReady: () => void }): ReactElement {
  useLayoutEffect(onReady, [onReady]);
  const series = spec.series[0]!;
  const shared = { data: spec.data, categoryKey: spec.categoryKey!, valueKey: series.key,
    ...(series.color !== undefined ? { color: series.color } : {}), ...(series.label !== undefined ? { label: series.label } : {}),
    ...(spec.title !== undefined ? { title: spec.title } : {}), ...(spec.description !== undefined ? { description: spec.description } : {}),
  };
  if (spec.kind === 'bar') return <BarChart {...shared} />;
  if (spec.kind === 'line') return <LineChart {...shared} />;
  const data = spec.data.map((row) => ({ name: String(row[spec.categoryKey!] ?? ''), value: row[series.key] as number }));
  return <PieChart {...shared} data={data} />;
}

/** Mount/update/destroy implements the UI vanilla ABI; no host React instance is shared.
 * @throws {UnsupportedChartSpecError} The single-series artifact cannot render the supplied spec.
 * @example mount({ element, spec, theme }, { onError: reportProviderFailure })
 */
export function mount(
  { element, ...input }: ChartRenderInput & { element: HTMLElement },
  options: ChartMountOptions = {},
): ChartInstance {
  if (!supportsRechartsSpec({ spec: input.spec })) throw new UnsupportedChartSpecError();
  let destroyed = false;
  let pending: { resolve: () => void; reject: (error: unknown) => void } | undefined;
  function reportError(error: unknown): void { pending?.reject(error); pending = undefined; options.onError?.(error); }
  const root = createRoot(element, { onUncaughtError: reportError, onCaughtError: () => {} });
  /** Each render settles its own acknowledgement; newer renders supersede pending commits. */
  function render(next: ChartRenderInput): Promise<void> {
    if (destroyed) return Promise.resolve();
    if (!supportsRechartsSpec({ spec: next.spec })) throw new UnsupportedChartSpecError();
    pending?.resolve(); applyChartTheme({ element, theme: next.theme });
    return new Promise((resolve, reject) => {
      const task = { resolve, reject }; pending = task;
      root.render(<ProviderBoundary onError={reportError}>
        <ProviderChart {...next} onReady={() => { if (pending === task) pending = undefined; resolve(); }} />
      </ProviderBoundary>);
    });
  }
  const ready = render(input);
  return {
    ready,
    update(next, _options = {}) { return render(next); },
    destroy(_input = {}, _options = {}) {
      if (destroyed) return;
      destroyed = true; pending?.resolve(); pending = undefined; root.unmount(); element.replaceChildren();
    },
  };
}

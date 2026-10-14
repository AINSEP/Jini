/** Framework-free mounting, failure recovery and table fallback. No React imports. */
import { DEFAULT_CHART_THEME, type ChartInstance, type ChartProvider, type ChartRenderInput, type ChartSpec, type ChartTheme } from './contract.js';
import { selectChartProviders, type ChartProviderRegistry, type RegisteredChartProvider } from './registry.js';
import { applyChartTheme, renderChartTable } from './table.js';
export { applyChartTheme, renderChartTable } from './table.js';

export interface MountChartOptions {
  readonly theme?: ChartTheme;
  readonly siteProvider?: string | undefined;
  readonly onProviderError?: (input: { provider: string; error: unknown }) => void;
}
export interface MountedChart extends ChartInstance {
  readonly ready: Promise<void>;
  update(input: { spec: ChartSpec; theme?: ChartTheme }, options?: Record<string, never>): Promise<void>;
}

/** Dynamic import is native; the host supplies an admitted immutable module URL and loads its CSS
 * at the rendering boundary. No manifest URL is itself a trust grant.
 */
export async function loadChartProvider(
  { url }: { url: string },
  { importModule = ({ url }: { url: string }) => import(/* @vite-ignore */ url) }: { importModule?: (input: { url: string }, options?: Record<string, never>) => Promise<unknown> } = {},
): Promise<ChartProvider> {
  const module = await importModule({ url }) as { mount?: unknown };
  if (typeof module?.mount !== 'function') throw new TypeError('Chart provider must export mount.');
  return module as ChartProvider;
}

/** Mount a vanilla provider into its own child node, keeping data visible until ready. Updates and
 * teardown invalidate pending loads so stale completions never attach to an unmounted host.
 * @example mountChart({ element, spec, registry }, { siteProvider: 'plugin.recharts' })
 */
export function mountChart(
  { element, spec, registry }: { element: HTMLElement; spec: ChartSpec; registry: ChartProviderRegistry },
  options: MountChartOptions = {},
): MountedChart {
  const fallback = element.ownerDocument.createElement('div'); fallback.dataset.chartFallback = '';
  const renderer = element.ownerDocument.createElement('div'); renderer.dataset.chartRenderer = '';
  element.append(fallback, renderer);
  let input: ChartRenderInput = { spec, theme: options.theme ?? DEFAULT_CHART_THEME };
  let active: { entry: RegisteredChartProvider; instance: ChartInstance } | undefined;
  let generation = 0;
  let revision = 0;
  let destroyed = false;
  const failed = new Set<string>();

  /** Provider errors never prevent other providers or the data table from remaining usable. */
  function report(entry: RegisteredChartProvider, error: unknown): void {
    try { options.onProviderError?.({ provider: entry.id, error }); } catch {
      // A host diagnostic failure must not strand a renderer or hide the data fallback.
    }
  }
  function dispose(): void {
    const previous = active; active = undefined;
    if (previous) {
      try { previous.instance.destroy({}); } catch (error) { report(previous.entry, error); }
    }
    renderer.replaceChildren(); fallback.hidden = false;
  }
  function showData(): void {
    applyChartTheme({ element, theme: input.theme }); renderChartTable({ element: fallback, spec: input.spec });
    fallback.hidden = false;
  }
  function candidates(): readonly RegisteredChartProvider[] {
    return selectChartProviders({ registry, spec: input.spec }, { siteProvider: options.siteProvider }).filter(({ id }) => !failed.has(id));
  }
  /** Async renderer errors arrive after mount; defer teardown outside the provider's commit. */
  function renderError(entry: RegisteredChartProvider, error: unknown, token: number): void {
    queueMicrotask(() => {
      if (destroyed || token !== generation || active?.entry.id !== entry.id) return;
      failed.add(entry.id); report(entry, error); generation++; dispose();
      void attempt(generation);
    });
  }
  async function attempt(token: number): Promise<void> {
    for (const entry of candidates()) {
      let renderRevision = revision;
      try {
        const provider = await entry.load({});
        if (destroyed || token !== generation) return;
        const frame = element.ownerDocument.createElement('div'); renderer.replaceChildren(frame);
        renderRevision = revision;
        const instance = provider.mount({ element: frame, ...input }, { onError: (error) => renderError(entry, error, token) });
        active = { entry, instance };
        await instance.ready;
        if (destroyed || token !== generation || renderRevision !== revision) return;
        fallback.hidden = true; return;
      } catch (error) {
        if (destroyed || token !== generation || renderRevision !== revision) return;
        failed.add(entry.id); report(entry, error); dispose();
      }
    }
  }
  showData();
  const ready = attempt(generation);
  return {
    ready,
    async update({ spec: nextSpec, theme = input.theme }, _options = {}) {
      if (destroyed) return;
      const updateRevision = ++revision;
      input = { spec: nextSpec, theme }; showData();
      const preferred = candidates()[0];
      if (active && preferred?.id === active.entry.id) {
        const current = active;
        try {
          await current.instance.update(input);
          if (!destroyed && active === current && updateRevision === revision) fallback.hidden = true;
          return;
        } catch (error) {
          if (destroyed || active !== current || updateRevision !== revision) return;
          failed.add(current.entry.id); report(current.entry, error);
        }
      }
      generation++; dispose(); await attempt(generation);
    },
    destroy(_input = {}, _options = {}) {
      if (destroyed) return;
      destroyed = true; generation++; dispose(); fallback.remove(); renderer.remove();
    },
  };
}

/** Framework-free mounting, failure recovery and table fallback. No React imports. */
import {
  type ChartInstance,
  type ChartProvider,
  type ChartRenderInput,
  type ChartSpec,
  type ChartTheme,
} from '@jini-ai/core/contracts/charts';
import { DEFAULT_CHART_THEME } from './default-theme.js';
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
): Promise<ChartProvider<HTMLElement>> {
  const module = await importModule({ url }) as { mount?: unknown };
  if (typeof module?.mount !== 'function') throw new TypeError('Chart provider must export mount.');
  return module as ChartProvider<HTMLElement>;
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

  let active: ActiveChart | undefined;
  let generation = 0;
  let revision = 0;
  let destroyed = false;
  const failed = new Set<string>();
  const state: ChartMountState = {
    element, registry, options, fallback, renderer, failed,
    get input() { return input; }, set input(value) { input = value; },
    get active() { return active; }, set active(value) { active = value; },
    get generation() { return generation; }, set generation(value) { generation = value; },
    get revision() { return revision; }, set revision(value) { revision = value; },
    get destroyed() { return destroyed; }, set destroyed(value) { destroyed = value; },
  };
  const presentation = createChartPresentation(state);
  const { showData } = presentation;
  const renderError = createChartRenderError(state, presentation, () => attempt);
  const attempt = createChartAttempt(state, { ...presentation, renderError });
  showData();
  const ready = attempt(generation);
  return createMountedChart(state, { ...presentation, attempt }, ready);
}

type ActiveChart = { entry: RegisteredChartProvider; instance: ChartInstance };
interface ChartMountState {
  element: HTMLElement; registry: ChartProviderRegistry; options: MountChartOptions;
  fallback: HTMLElement; renderer: HTMLElement; failed: Set<string>;
  input: ChartRenderInput; active: ActiveChart | undefined;
  generation: number; revision: number; destroyed: boolean;
}

function createChartPresentation(state: ChartMountState) {
  const { element, registry, options, fallback, renderer, failed } = state;


  /** Provider errors never prevent other providers or the data table from remaining usable. */
  function report(entry: RegisteredChartProvider, error: unknown): void {
    try { options.onProviderError?.({ provider: entry.id, error }); } catch {
      // A host diagnostic failure must not strand a renderer or hide the data fallback.
    }
  }

  function dispose(): void {
    const previous = state.active; state.active = undefined;
    if (previous) {
      try { previous.instance.destroy({}); } catch (error) { report(previous.entry, error); }
    }
    renderer.replaceChildren(); fallback.hidden = false;
  }

  function showData(): void {
    applyChartTheme({ element, theme: state.input.theme }); renderChartTable({ element: fallback, spec: state.input.spec });
    fallback.hidden = false;
  }

  function candidates(): readonly RegisteredChartProvider[] {
    return selectChartProviders({ registry, spec: state.input.spec }, { siteProvider: options.siteProvider }).filter(({ id }) => !failed.has(id));
  }

  function isStaleMount({ token }: { token: number }, _options: Record<string, never> = {}): boolean {
    return state.destroyed || token !== state.generation;
  }

  function isCurrentUpdate(
    { current, updateRevision }: { current: ActiveChart; updateRevision: number },
    _options: Record<string, never> = {},
  ): boolean {
    return !state.destroyed && state.active === current && updateRevision === state.revision;
  }
  function isStaleRender({ token, renderRevision }: { token: number; renderRevision: number }): boolean {
    return isStaleMount({ token }) || renderRevision !== state.revision;
  }
  return { report, dispose, showData, candidates, isStaleMount, isCurrentUpdate, isStaleRender };
}

function createChartRenderError(state: ChartMountState, { report, dispose }: Pick<ReturnType<typeof createChartPresentation>, 'report' | 'dispose'>, getAttempt: () => ReturnType<typeof createChartAttempt>): (entry: RegisteredChartProvider, error: unknown, token: number) => void {
  const { failed } = state;

  /** Async renderer errors arrive after mount; defer teardown outside the provider's commit. */
  function renderError(entry: RegisteredChartProvider, error: unknown, token: number): void {
    queueMicrotask(() => {
      if (state.destroyed || token !== state.generation || state.active?.entry.id !== entry.id) return;
      failed.add(entry.id); report(entry, error); state.generation++; dispose();
      void getAttempt()(state.generation);
    });
  }
  return renderError;
}

function createChartAttempt(state: ChartMountState, { candidates, isStaleMount, isStaleRender, report, dispose, renderError }: Pick<ReturnType<typeof createChartPresentation>, 'candidates' | 'isStaleMount' | 'isStaleRender' | 'report' | 'dispose'> & { renderError: ReturnType<typeof createChartRenderError> }): (token: number) => Promise<void> {
  const { element, renderer, fallback, failed } = state;

  async function attempt(token: number): Promise<void> {
    for (const entry of candidates()) {
      let renderRevision = state.revision;
      try {
        const provider = await entry.load({});
        if (isStaleMount({ token })) return;
        const frame = element.ownerDocument.createElement('div'); renderer.replaceChildren(frame);
        renderRevision = state.revision;
        const instance = provider.mount({ element: frame, applyTheme: applyChartTheme, ...state.input }, { onError: (error) => renderError(entry, error, token) });
        state.active = { entry, instance };
        await instance.ready;
        if (isStaleRender({ token, renderRevision })) return;
        fallback.hidden = true; return;
      } catch (error) {
        if (isStaleRender({ token, renderRevision })) return;
        failed.add(entry.id); report(entry, error); dispose();
      }
    }
  }
  return attempt;
}

function createMountedChart(state: ChartMountState, { showData, candidates, isCurrentUpdate, report, dispose, attempt }: Pick<ReturnType<typeof createChartPresentation>, 'showData' | 'candidates' | 'isCurrentUpdate' | 'report' | 'dispose'> & { attempt: ReturnType<typeof createChartAttempt> }, ready: Promise<void>): MountedChart {
  const { fallback, renderer, failed } = state;

  return {
    ready,
    async update({ spec: nextSpec, theme = state.input.theme }, _options = {}) {
      if (state.destroyed) return;
      state.revision += 1;
      const updateRevision = state.revision;
      state.input = { spec: nextSpec, theme }; showData();
      const preferred = candidates()[0];
      if (state.active && preferred?.id === state.active.entry.id) {
        const current = state.active;
        try {
          await current.instance.update(state.input);
          if (isCurrentUpdate({ current, updateRevision })) fallback.hidden = true;
          return;
        } catch (error) {
          if (!isCurrentUpdate({ current, updateRevision })) return;
          failed.add(current.entry.id); report(current.entry, error);
        }
      }
      state.generation++; dispose(); await attempt(state.generation);
    },
    destroy(_input = {}, _options = {}) {
      if (state.destroyed) return;
      state.destroyed = true; state.generation++; dispose(); fallback.remove(); renderer.remove();
    },
  };
}

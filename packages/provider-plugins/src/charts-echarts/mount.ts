/** ECharts owns one SVG chart inside the vanilla provider's assigned element; no host framework is shared. */
import { init, use, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ChartInstance, ChartMountOptions, ChartRenderInput, ChartSpec } from '@jini-ai/ui/charts';
import { applyChartTheme } from '@jini-ai/ui/charts/browser';
import { ECHARTS_PROVIDER_ID, supportsEChartsSpec } from './descriptor.js';
import { buildEChartsOption, chartTitle } from './option.js';

// Only what the seven kinds draw is registered, so the bundle carries ECharts' modular core, not the
// whole library. Title is registered (never shown) because the aria description reads its text.
use([BarChart, LineChart, PieChart, ScatterChart, AriaComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer]);

/** Every update replaces these whole, so a kind change (bar → pie) or a dropped series leaves nothing behind. */
const REPLACED_COMPONENTS = ['series', 'xAxis', 'yAxis', 'grid'];
/** The same plot height as the Recharts provider; width follows the host frame. */
const CHART_HEIGHT_PX = 300;

export class UnsupportedChartSpecError extends Error {
  constructor() { super('Unsupported ECharts chart specification.'); this.name = 'UnsupportedChartSpecError'; }
}

interface ChartFrame { readonly figure: HTMLElement; readonly caption: HTMLElement; readonly surface: HTMLElement }

/** The figure, its visually hidden caption and the surface ECharts draws into (inline size, so the
 * first draw is measured even before the stylesheet applies). */
function createFrame({ element }: { element: HTMLElement }): ChartFrame {
  const doc = element.ownerDocument;
  const figure = doc.createElement('figure'); figure.className = 'jini-chart'; figure.dataset.chartProvider = ECHARTS_PROVIDER_ID;
  const caption = doc.createElement('figcaption'); caption.className = 'jini-chart-caption';
  const surface = doc.createElement('div'); surface.className = 'jini-chart-surface';
  surface.style.width = '100%'; surface.style.height = `${CHART_HEIGHT_PX}px`;
  figure.append(caption, surface); element.replaceChildren(figure);
  return { figure, caption, surface };
}

/** Title and description go in through textContent: agent-supplied text never reaches innerHTML. */
function describeFrame({ figure, caption, spec, descriptionId }: ChartFrame & { spec: ChartSpec; descriptionId: string }): void {
  const text = chartTitle({ spec });
  const title = figure.ownerDocument.createElement('span'); title.textContent = text;
  caption.replaceChildren(title);
  figure.setAttribute('aria-label', text);
  figure.removeAttribute('aria-describedby');
  if (spec.description === undefined) return;
  const description = figure.ownerDocument.createElement('span');
  description.id = descriptionId; description.textContent = spec.description;
  caption.append(description); figure.setAttribute('aria-describedby', description.id);
}

/** Width follows the frame; height is fixed. Without a ResizeObserver the first measurement stays. */
function observeWidth({ surface, chart }: { surface: HTMLElement; chart: EChartsType }): ResizeObserver | undefined {
  if (typeof ResizeObserver !== 'function') return undefined;
  const observer = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
  observer.observe(surface);
  return observer;
}

/** Mount/update/destroy implements the UI vanilla ABI. ECharts draws synchronously, so `ready` is already
 * settled and a failing draw throws from mount or update, where the host's fallback chain catches it.
 * @throws {UnsupportedChartSpecError} The spec is outside what this artifact draws (see supportsEChartsSpec).
 * @example mount({ element, spec, theme })
 */
export function mount(
  { element, ...input }: ChartRenderInput & { element: HTMLElement },
  _options: ChartMountOptions = {},
): ChartInstance {
  if (!supportsEChartsSpec({ spec: input.spec })) throw new UnsupportedChartSpecError();
  const frame = createFrame({ element });
  const chart = init(frame.surface, undefined, { renderer: 'svg' });
  // ECharts' own instance id is unique per page, so the description id needs no module counter.
  const descriptionId = `jini-echarts-description-${chart.id}`;
  let destroyed = false;
  function render(next: ChartRenderInput): void {
    if (destroyed) return;
    if (!supportsEChartsSpec({ spec: next.spec })) throw new UnsupportedChartSpecError();
    applyChartTheme({ element, theme: next.theme });
    describeFrame({ ...frame, spec: next.spec, descriptionId });
    chart.setOption(buildEChartsOption({ spec: next.spec }), { replaceMerge: REPLACED_COMPONENTS });
  }
  try { render(input); } catch (error) { chart.dispose(); element.replaceChildren(); throw error; }
  const observer = observeWidth({ surface: frame.surface, chart });
  return {
    ready: Promise.resolve(),
    update(next, _updateOptions = {}) { render(next); },
    destroy(_input = {}, _destroyOptions = {}) {
      if (destroyed) return;
      destroyed = true; observer?.disconnect(); chart.dispose(); element.replaceChildren();
    },
  };
}

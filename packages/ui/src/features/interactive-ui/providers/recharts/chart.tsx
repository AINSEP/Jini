import { createContext, useContext, useId, type ReactElement, type ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { formatChartValue, type ChartConfig } from './chart-config.js';
import { CHART_PRIMARY_COLOR } from './chart-tokens.js';

const ChartContext = createContext<ChartConfig>({});

interface ChartContainerProps {
  readonly config: ChartConfig;
  readonly title: string;
  readonly description: string;
  readonly children: ReactElement;
}

/** Shared, measurable chart frame with an accessible caption and a wrapping legend. */
export function ChartContainer({ config, title, description, children }: ChartContainerProps): ReactElement {
  const id = useId();
  return (
    <ChartContext.Provider value={config}>
      <figure className="jini-chart" aria-label={title} aria-describedby={`${id}-description`}>
        <figcaption className="jini-chart-caption">
          <span>{title}</span>
          <span id={`${id}-description`}>{description}</span>
        </figcaption>
        <ResponsiveContainer width="100%" height={300} minWidth={0}>
          {children}
        </ResponsiveContainer>
        <ChartLegendContent />
      </figure>
    </ChartContext.Provider>
  );
}

interface ChartTooltipEntry {
  readonly dataKey?: unknown;
  readonly name?: string | number;
  readonly value?: unknown;
  readonly color?: string;
  readonly type?: string;
  readonly payload?: { readonly _jiniChartKey?: string };
}

interface ChartTooltipContentProps {
  readonly active?: boolean;
  readonly label?: ReactNode;
  readonly payload?: readonly ChartTooltipEntry[];
}

/** Shadcn-style tooltip card; series config owns both labels and swatch colors. */
export function ChartTooltipContent({ active, label, payload = [] }: ChartTooltipContentProps): ReactElement | null {
  const config = useContext(ChartContext);
  const entries = payload.filter((entry) => entry.type !== 'none' && entry.value != null);
  if (!active || entries.length === 0) return null;
  return (
    <div className="jini-chart-tooltip" role="tooltip" aria-live="polite" aria-atomic="true">
      {label != null && <div className="jini-chart-tooltip-label">{label}</div>}
      <div className="jini-chart-tooltip-items">
        {entries.map((entry, index) => {
          // Pie names may repeat; its internal key keeps swatches tied to the actual slice.
          const dataKey = String(entry.dataKey ?? entry.name);
          const key = Object.hasOwn(config, dataKey) ? dataKey : entry.payload?._jiniChartKey ?? dataKey;
          const series = Object.hasOwn(config, key) ? config[key] : undefined;
          return (
            <div className="jini-chart-tooltip-item" key={`${key}-${index}`}>
              <span className="jini-chart-swatch" style={{ backgroundColor: series?.color ?? entry.color ?? CHART_PRIMARY_COLOR }} aria-hidden="true" />
              <span className="jini-chart-tooltip-name">{series?.label ?? String(entry.name ?? entry.dataKey ?? 'Value')}</span>
              <span className="jini-chart-tooltip-value">{formatChartValue({ value: entry.value })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact named legend; pie values remain readable without hover or outside labels. */
export function ChartLegendContent(): ReactElement | null {
  const config = useContext(ChartContext);
  const entries = Object.entries(config);
  if (entries.length === 0) return null;
  return (
    <ul className="jini-chart-legend" aria-label="Chart legend">
      {entries.map(([key, series]) => (
        <li className="jini-chart-legend-item" key={key}>
          <span className="jini-chart-swatch" style={{ backgroundColor: series.color }} aria-hidden="true" />
          <span>{series.label}</span>
          {series.value !== undefined && <span className="jini-chart-legend-value">{formatChartValue({ value: series.value })}</span>}
        </li>
      ))}
    </ul>
  );
}

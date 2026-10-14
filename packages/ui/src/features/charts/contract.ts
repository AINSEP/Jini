/** Framework-neutral chart data and vanilla provider ABI. Providers declare their own kinds. */
import { z } from 'zod';

export type ChartKind = 'bar' | 'line' | 'pie' | (string & {});
export type ChartValue = string | number | boolean | null | ChartValue[] | { [key: string]: ChartValue };
const chartValueSchema: z.ZodType<ChartValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(chartValueSchema), z.record(chartValueSchema),
]));
const formatSchema = z.object({ locale: z.string().optional(), notation: z.enum(['standard', 'compact']).optional() }).strict();
const axisSchema = z.object({ label: z.string().optional(), format: formatSchema.optional() }).strict();

/** Serializable, provider-neutral specification; kind admission belongs to each provider. */
export const chartSpecSchema = z.object({
  kind: z.string().min(1),
  data: z.array(z.record(chartValueSchema)),
  categoryKey: z.string().optional(),
  series: z.array(z.object({ key: z.string(), label: z.string().optional(), color: z.string().optional() }).strict()),
  title: z.string().optional(),
  description: z.string().optional(),
  axes: z.object({ x: axisSchema.optional(), y: axisSchema.optional() }).strict().optional(),
  format: formatSchema.optional(),
  provider: z.string().min(1).optional(),
}).strict();
export type ChartSpec = Omit<z.infer<typeof chartSpecSchema>, 'kind'> & { readonly kind: ChartKind };

/** CSS token names are common across providers; no library props cross this boundary. */
export interface ChartTheme {
  readonly mode: 'light' | 'dark' | 'auto';
  readonly tokens?: Readonly<Record<string, string>>;
}
export const DEFAULT_CHART_THEME: ChartTheme = { mode: 'auto' };
export interface ChartRenderInput { readonly spec: ChartSpec; readonly theme: ChartTheme }
export interface ChartMountOptions {
  /** Reports errors occurring after mount returns (for example a React commit failure). */
  readonly onError?: (error: unknown) => void;
}
export interface ChartInstance {
  /** Hosts retain the fallback until an asynchronous first render completes. */
  readonly ready?: Promise<void>;
  update(input: ChartRenderInput, options?: Record<string, never>): void | Promise<void>;
  destroy(input: Record<string, never>, options?: Record<string, never>): void;
}
export interface ChartProvider {
  mount(input: ChartRenderInput & { readonly element: HTMLElement }, options?: ChartMountOptions): ChartInstance;
}
export interface ChartProviderEntry {
  readonly id: string;
  readonly kinds: readonly ChartKind[];
  readonly enabled: boolean;
  /** Optional stricter admission, e.g. rejecting multi-series specs until implemented. */
  readonly supports?: (input: { readonly spec: ChartSpec }, options?: Record<string, never>) => boolean;
  load(input: Record<string, never>, options?: Record<string, never>): Promise<ChartProvider>;
}

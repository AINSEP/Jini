/** @agent-note Types and one constant. What chart providers implement; generic over the host element type
 * so this entry carries no DOM lib. */

export type ChartKind = 'bar' | 'line' | 'pie' | (string & {});
export type ChartValue = string | number | boolean | null | ChartValue[] | { [key: string]: ChartValue };

interface ChartFormat { locale?: string | undefined; notation?: 'standard' | 'compact' | undefined }
interface ChartAxis { label?: string | undefined; format?: ChartFormat | undefined }

/** Serializable, provider-neutral specification; kind admission belongs to each provider. */
export interface ChartSpec {
  readonly kind: ChartKind;
  data: Record<string, ChartValue>[];
  categoryKey?: string | undefined;
  series: { key: string; label?: string | undefined; color?: string | undefined }[];
  title?: string | undefined;
  description?: string | undefined;
  axes?: { x?: ChartAxis | undefined; y?: ChartAxis | undefined } | undefined;
  format?: ChartFormat | undefined;
  provider?: string | undefined;
}

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
/** Applies the theme's tokens to the element a provider draws into; the host supplies it at mount. */
export type ChartThemeApplier<E = unknown> = (input: { element: E; theme: ChartTheme }, options?: Record<string, never>) => void;
export interface ChartProvider<E = unknown> {
  mount(input: ChartRenderInput & { readonly element: E; readonly applyTheme: ChartThemeApplier<E> }, options?: ChartMountOptions): ChartInstance;
}
export interface ChartProviderEntry<E = unknown> {
  readonly id: string;
  readonly kinds: readonly ChartKind[];
  readonly enabled: boolean;
  /** Optional stricter admission, e.g. rejecting multi-series specs until implemented. */
  readonly supports?: (input: { readonly spec: ChartSpec }, options?: Record<string, never>) => boolean;
  load(input: Record<string, never>, options?: Record<string, never>): Promise<ChartProvider<E>>;
}

import { AdminApiError, describeApiError } from '../core/transport/errors.js';
import type { AdminWidget, AdminWidgetPlacement, AdminWidgetType, WidgetTypeOption, WidgetsTranslate, WidgetSlugRedirectPath, WidgetEditorParams } from './models.js';
import { widgetsEnglish } from './messages.en.js';
export const WIDGETS_LIBRARY_RESOURCE = 'widgets-library';
// Regions are a separate list; placement editors use baseVersion rather than live refresh.
export const WIDGETS_REGIONS_RESOURCE = 'widgets-regions';
/** Normalize only the documented host API error shape; preserve the existing shared error owner. */
export function widgetApiError({ error }: { error: unknown }, _optional: Record<string, never> = {}): AdminApiError | null {
  if (error instanceof AdminApiError) return error;
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    const host = error as Error & { status: number; code?: string | undefined; body?: Record<string, unknown> | undefined };
    return new AdminApiError({ message: host.message, status: host.status }, { code: host.code, body: host.body });
  }
  return null;
}
/** Resolve the host catalog's label, then translate; unknown stored types retain their raw value. */
export function widgetTypeLabel({ widgetType, types }: { widgetType: string; types: readonly WidgetTypeOption[] }, { t = widgetsEnglish }: { t?: WidgetsTranslate | undefined } = {}): string {
  return t(types.find(o => o.value === widgetType)?.label ?? widgetType);
}
/** Creation accepts only the host catalog; stored types remain an open vocabulary. */
export function isKnownWidgetType({ widgetType, types }: { widgetType: string; types: readonly WidgetTypeOption[] }, _optional: Record<string, never> = {}): boolean {
  return types.some(o => o.value === widgetType);
}
export function widgetConfigFieldErrors({ error }: { error: unknown }, _optional: Record<string, never> = {}): Array<{ field: string; reason: string }> {
  const e = widgetApiError({ error });
  if (e?.code !== 'WIDGETS_CONFIG_VALIDATION_ERROR') return [];
  const details = e.body?.details as { fieldErrors?: Array<{ field: string; reason: string }> | undefined } | undefined;
  return details?.fieldErrors ?? [];
}
/** Missing loaded data deliberately resolves to undefined, matching the original editor. */
export function resolveEditorWidgetType({ isNew, queryWidgetType, widget }: { isNew: boolean; queryWidgetType: string | null; widget: AdminWidget | null }, _optional: Record<string, never> = {}): AdminWidgetType | null | undefined {
  return isNew ? queryWidgetType : widget?.widgetType;
}
/** Copy before swapping; an out-of-bounds move retains the original reference. O(n) per move. */
export function movePlacement<T>({ items, index, direction }: { items: T[]; index: number; direction: -1 | 1 }, _optional: Record<string, never> = {}): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
// Distinguishes draft keys created in the same millisecond without randomUUID.
let draftPlacementSequence = 0;
/** Draft identity survives reorder/remove/toggle until the server accepts the ordered placements. */
export function buildDraftPlacement({ widgetInstanceId }: { widgetInstanceId: string }, { id = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${++draftPlacementSequence}` }: { id?: (() => string) | undefined } = {}): AdminWidgetPlacement {
  return { placementId: id(), widgetEntryId: widgetInstanceId, enabled: true, widgetTitle: null, widgetType: null, broken: false };
}
export interface WidgetSaveErrorOutcome { error: string; fieldErrors: Array<{ field: string; reason: string }> }
/** Conflict copy is domain-specific; other failures use the existing admin error describer. */
export function resolveWidgetSaveError({ error }: { error: unknown }, { t = widgetsEnglish }: { t?: WidgetsTranslate | undefined } = {}): WidgetSaveErrorOutcome {
  const e = widgetApiError({ error });
  if (e?.code === 'WIDGETS_VERSION_CONFLICT') return { error: t('This widget changed since you loaded it, refresh and try again.'), fieldErrors: [] };
  return { error: describeApiError({ e: e ?? error, fallback: t('save failed') }), fieldErrors: widgetConfigFieldErrors({ error }) };
}
export function resolveWidgetRegionSaveError({ error }: { error: unknown }, { t = widgetsEnglish }: { t?: WidgetsTranslate | undefined } = {}): string {
  const e = widgetApiError({ error });
  if (e?.code === 'WIDGETS_AREA_CONFLICT') return t('This region changed since you loaded it, refresh and try again.');
  return describeApiError({ e: e ?? error, fallback: t('save failed') });
}
/** The general slug rule remains host-owned and optional; no parallel slug policy is introduced. */
export function widgetSlugRedirectPath({ requestedId, widget }: { requestedId: string; widget: Pick<AdminWidget, 'id' | 'slug'> }, { slugRedirectPath }: { slugRedirectPath?: WidgetSlugRedirectPath | undefined } = {}): string | null {
  return slugRedirectPath?.('/widgets', requestedId, widget) ?? null;
}
export type WidgetInstanceGuard = { kind: 'fetch-error'; message: string } | { kind: 'loading' } | { kind: 'no-type' } | { kind: 'unknown-type'; widgetType: string };
/** Catch a garbage ?type= before a live create editor can save it; existing types are server-validated. */
export function widgetInstanceGuard(required: WidgetInstanceGuardInput, _optional: Record<string, never> = {}): WidgetInstanceGuard | null {
  return widgetEditorGate(required).guard;
}
export interface WidgetInstanceGuardInput { error: string | null; isNew: boolean; widget: AdminWidget | null; loading: boolean; widgetType: string | null | undefined; types: readonly WidgetTypeOption[] }
/** The editor's gate: either the guard to render, or the widget type the live editor needs. Once no
 *  guard applies the "no-type" case has already ruled out a missing type, and returning it here
 *  carries that narrowing to the page, which otherwise needed its own never-taken null check. */
export type WidgetEditorGate = { guard: WidgetInstanceGuard; widgetType?: undefined } | { guard: null; widgetType: string };
export function widgetEditorGate({ error, isNew, widget, loading, widgetType, types }: WidgetInstanceGuardInput, _optional: Record<string, never> = {}): WidgetEditorGate {
  if (error && !isNew && !widget) return { guard: { kind: 'fetch-error', message: error } };
  if (loading) return { guard: { kind: 'loading' } };
  if (!widgetType) return { guard: { kind: 'no-type' } };
  if (isNew && !isKnownWidgetType({ widgetType, types })) return { guard: { kind: 'unknown-type', widgetType } };
  return { guard: null, widgetType };
}

/** Match the original save identity, including the query type on /new. */
export function widgetEntityKey({ params }: { params: WidgetEditorParams }, _optional: Record<string, never> = {}): string {
  return `${params.widgetId ?? ''}::${params.widgetType ?? ''}::${params.widgetId === null}`;
}

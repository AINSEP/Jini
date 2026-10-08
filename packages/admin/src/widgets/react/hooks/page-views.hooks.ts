import { buildAgentListHandles } from '@jini-ai/agentic';
import { useWiredWidgetsLibrary } from './use-widgets-library.hooks.js';
import { useWiredWidgetRegions } from './use-widget-regions.hooks.js';
import { useWiredWidgetRegionEditor } from './use-widget-region-editor.hooks.js';
/** Stable ids supply per-row handles because DataTable cells receive a row, not its index. */
export function useWidgetsLibraryView({ useWidgetsLibraryHook = useWiredWidgetsLibrary }: { useWidgetsLibraryHook?: typeof useWiredWidgetsLibrary | undefined }, _optional: Record<string, never> = {}) {
  const state = useWidgetsLibraryHook();
  const widgets = state.widgets ?? [];
  const handles = buildAgentListHandles({ prefix: 'widgets-row', ids: widgets.map(w => w.id) });
  return { ...state, rowHandleById: new Map(widgets.map((w, i) => [w.id, handles[i]!])) };
}
export function useWidgetRegionsView({ useWidgetRegionsHook = useWiredWidgetRegions }: { useWidgetRegionsHook?: typeof useWiredWidgetRegions | undefined }, _optional: Record<string, never> = {}) {
  const state = useWidgetRegionsHook();
  const regions = state.regions ?? [];
  const handles = buildAgentListHandles({ prefix: 'widget-regions-row', ids: regions.map(r => r.regionKey) });
  return { ...state, rowHandleByKey: new Map(regions.map((r, i) => [r.regionKey, handles[i]!])) };
}
export function useWidgetRegionEditorView({ regionKey, useWidgetRegionEditorHook = useWiredWidgetRegionEditor }: { regionKey: string; useWidgetRegionEditorHook?: typeof useWiredWidgetRegionEditor | undefined }, _optional: Record<string, never> = {}) {
  const state = useWidgetRegionEditorHook(regionKey);
  return { ...state, placementHandles: buildAgentListHandles({ prefix: 'widget-region-placement', ids: state.placements.map(p => p.placementId) }) };
}
import type { MouseEvent } from 'react';
import type { WidgetTypeOption } from '../../models.js';
import { widgetInstanceGuard } from '../../rules.js';
import { useWiredWidgetInstanceEditor } from './use-widget-instance-editor.hooks.js';
/** The back-link cancellation also stops the host's document-level internal-link interceptor. */
export function useWidgetInstanceEditorView({ widgetId, widgetType, widgetTypes, useWidgetInstanceEditorHook = useWiredWidgetInstanceEditor }: { widgetId: string | null; widgetType: string | null; widgetTypes: readonly WidgetTypeOption[]; useWidgetInstanceEditorHook?: typeof useWiredWidgetInstanceEditor | undefined }, _optional: Record<string, never> = {}) {
  const state = useWidgetInstanceEditorHook({ widgetId, widgetType });
  return { ...state, guard: widgetInstanceGuard({ ...state, types: widgetTypes }), onBackClick: (event: MouseEvent<HTMLAnchorElement>) => { if (!state.confirmLeave()) event.preventDefault(); } };
}

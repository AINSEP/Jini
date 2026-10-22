import { adminPort } from '../core/module/token.js';
import type { AdminShellNavigationPort } from '../core/ports/shell.js';
import type { AdminWidget, AdminWidgetWhereUsed, AdminWidgetArea, AdminWidgetPlacement, AdminWidgetRegionBinding, AdminWidgetType, WidgetsRequestOptions } from './models.js';
/** Instance and region administration share one workspace-scoped API. Hosts authorize widgets.*,
 * validate configs and placement caps, and enforce baseVersion on writes. No purge or embed-write
 * operation is exposed: the four screens never call one; embeds appear in whereUsed only. */
export interface AdminWidgetsPort {
  listWidgets(required: { widgetType?: string | undefined; includeInactive?: boolean | undefined }, optional?: WidgetsRequestOptions | undefined): Promise<{ widgets: AdminWidget[]; skippedCount?: number | undefined; skippedIds?: string[] | undefined }>;
  getWidget(required: { id: string }, optional?: WidgetsRequestOptions | undefined): Promise<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>;
  createWidget(required: { widgetType: AdminWidgetType; title: string; config: Record<string, unknown> }, optional?: WidgetsRequestOptions | undefined): Promise<{ widget: AdminWidget }>;
  updateWidget(required: { id: string; baseVersion: number; config: Record<string, unknown>; title?: string | undefined }, optional?: WidgetsRequestOptions | undefined): Promise<{ widget: AdminWidget }>;
  trashWidget(required: { id: string }, optional?: WidgetsRequestOptions | undefined): Promise<{ ok: true; version: number | null }>;
  listWidgetRegions(required: Record<string, never>, optional?: WidgetsRequestOptions | undefined): Promise<{ regions: AdminWidgetRegionBinding[] }>;
  bindWidgetRegion(required: { regionKey: string }, optional?: WidgetsRequestOptions | undefined): Promise<{ area: AdminWidgetArea }>;
  getWidgetRegion(required: { regionKey: string }, optional?: WidgetsRequestOptions | undefined): Promise<{ area: AdminWidgetArea; placements: AdminWidgetPlacement[] }>;
  mutateWidgetRegionPlacements(required: { regionKey: string; baseVersion: number; placements: Array<{ placementId: string; widgetEntryId: string; enabled: boolean }> }, optional?: WidgetsRequestOptions | undefined): Promise<{ area: AdminWidgetArea }>;
}
/** The host filters refresh scope by resource, including null = all resources. */
export interface WidgetsEventsPort {
  subscribe(required: { resource: string; onRefresh: () => void }, optional?: Record<string, never> | undefined): () => void;
}
// core/ports/shell.ts exports AdminShellNavigationPort; no AdminShellPort exists in this tree.
export type WidgetsNavigationPort = Pick<AdminShellNavigationPort, 'navigate'>;
export const widgetsApiToken = adminPort<AdminWidgetsPort, 'admin.widgets.api'>({ id: 'admin.widgets.api' });
export const widgetsEventsToken = adminPort<WidgetsEventsPort, 'admin.widgets.events'>({ id: 'admin.widgets.events' });
export const widgetsNavigationToken = adminPort<WidgetsNavigationPort, 'admin.widgets.navigation'>({ id: 'admin.widgets.navigation' });

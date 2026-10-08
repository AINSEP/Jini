/** Host-defined widget types/status/reference kinds are open; the supplied catalog controls creation. */
export type AdminWidgetType = 'text' | 'social-links' | 'recent-entries' | 'menu' | 'contact-form' | (string & {});
export type AdminWidgetStatus = 'active' | 'trash' | 'purged' | (string & {});
export interface AdminWidget {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  status: AdminWidgetStatus;
  widgetType: AdminWidgetType;
  config: Record<string, unknown>;
  updatedAt: string;
  version: number;
}
export interface AdminWidgetWhereUsedReference {
  kind: 'region' | 'embed' | (string & {});
  sourceEntryId: string;
  fieldPath: string;
}
export interface AdminWidgetWhereUsed {
  count: number;
  references: AdminWidgetWhereUsedReference[];
}
export interface AdminWidgetPlacement {
  placementId: string;
  widgetEntryId: string;
  enabled: boolean;
  widgetTitle: string | null;
  widgetType: string | null;
  broken: boolean;
}
export interface AdminWidgetArea {
  id: string;
  workspaceId: string;
  regionKey: string;
  updatedAt: string;
  version: number;
}
export interface AdminWidgetRegionBinding {
  workspaceId: string;
  regionKey: string;
  areaEntryId: string;
  updatedAt: string;
  placementCount: number;
}

export type WidgetsTranslate = (key: string, vars?: Record<string, string | number> | undefined) => string;
export interface WidgetTypeOption { value: AdminWidgetType; label: string }
export interface WidgetsRequestOptions { signal?: AbortSignal | undefined }
export interface WidgetEditorParams { widgetId: string | null; widgetType: string | null }
export type WidgetSlugRedirectPath = (base: string, requestedId: string, item: { id: string; slug: string }) => string | null;

// ---------------------------------------------------------------------------
// Widgets (SPEC-043, ADR-047) — mirrors AdminMenu's shape, the direct structural sibling
// ---------------------------------------------------------------------------

export type AdminWidgetType = "text" | "social-links" | "recent-entries" | "menu" | "contact-form" | "gallery" | "media";

export interface AdminWidget {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  status: "active" | "trash" | "purged";
  widgetType: AdminWidgetType;
  config: Record<string, unknown>;
  updatedAt: string;
  version: number;
}

export interface AdminWidgetWhereUsedReference {
  kind: "region" | "embed";
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

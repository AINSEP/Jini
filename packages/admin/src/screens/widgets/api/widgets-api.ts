import { querySuffix } from "@jini-ai/core/admin-runtime";
import type { AdminWidget, AdminWidgetType, AdminWidgetWhereUsed } from "./widgets-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries and
 *  error decoding, so this client only names the method, path and body. */
export type WidgetsRequestFn = <T>(required: { method: string; path: string; body?: unknown }) => Promise<T>;

/** What the host injects: its authenticated request and the workspace every path is scoped to. */
export interface CreateWidgetsApiArgs { request: WidgetsRequestFn; workspaceId: string }

/** The admin API calls of the widgets feature, bound to the host's injected `request`.
 *  @example const widgetsApi = createWidgetsApi({ request, workspaceId }); */
export function createWidgetsApi({ request, workspaceId }: CreateWidgetsApiArgs, _optional: Record<string, never> = {}) {
  return {
    // -------------------------------------------------------------------------
    // Widgets (SPEC-043, ADR-047) — mirrors the Menus client functions' exact shape
    // -------------------------------------------------------------------------
    listWidgets: (options: { widgetType?: string; includeInactive?: boolean } = {}) => {
      const params = new URLSearchParams();
      if (options.widgetType) params.set("widgetType", options.widgetType);
      if (options.includeInactive) params.set("includeInactive", "true");
      const qs = params.toString();
      // `skippedCount`/`skippedIds` (dossier C5 follow-up, 2026-08-03) are additive and optional —
      // present only when the server dropped one or more malformed records. Absent in the common case.
      return request<{ widgets: AdminWidget[]; skippedCount?: number; skippedIds?: string[] }>({ method: "GET", path: `/workspaces/${workspaceId}/widgets${querySuffix({ query: qs })}` });
    },
    getWidget: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      request<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>({ method: "GET", path: `/workspaces/${workspaceId}/widgets/${encodeURIComponent(id)}` }),
    createWidget: (
      input: { widgetType: AdminWidgetType; title: string; config: Record<string, unknown> },
      options: { slug?: string } = {}
    ) =>
      request<{ widget: AdminWidget }>({ method: "POST", path: `/workspaces/${workspaceId}/widgets`, body: { ...input, ...options } }),
  };
}

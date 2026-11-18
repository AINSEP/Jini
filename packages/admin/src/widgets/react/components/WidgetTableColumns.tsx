import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { DataTableColumn } from "../../../react/components/DataTable.js";
import type { AdminWidget, WidgetTypeOption, WidgetsTranslate } from "../../models.js";
import { widgetTypeLabel } from "../../rules.js";

/** The widgets library table's columns, moved out of the page function so it stays within the size limit. */
export function widgetsLibraryColumns(
  { t, widgetTypes, statusLabel, rowHandleById, requestTrash }: {
    t: Translate; widgetTypes: readonly WidgetTypeOption[]; statusLabel: WidgetsTranslate | undefined;
    rowHandleById: ReadonlyMap<string, string>; requestTrash: (widget: AdminWidget) => void;
  },
  _optional: Record<string, never> = {},
): DataTableColumn<AdminWidget>[] {
  return [
    {
      key: "title",
      header: t("Title"),
      cell: (widget) => (
        <a
          // Slug, not id (2026-09-22, URL-uses-slug — mirrors `FormsList.tsx`'s
          // `/admin/forms/${form.slug}` row link): the editor resolves either
          // (`read-service.ts`'s `getWidgetInstance`), but the slug is the readable one.
          href={`/admin/widgets/${widget.slug}`}
          {...agentHandle({ handle: `${rowHandleById.get(widget.id)}-edit` }, { role: "link", label: `Edit the "${widget.title}" widget` })}
        >
          {widget.title}
        </a>
      ),
    },
    {
      key: "type",
      header: t("Type"),
      cell: (widget) => widgetTypeLabel({ widgetType: widget.widgetType, types: widgetTypes }, { t }),
    },
    {
      key: "slug",
      header: t("Slug"),
      // Monospace like Collections' "Key" column (`Collections.tsx`) — a slug is an
      // identifier, not prose.
      cell: (widget) => <code>{widget.slug}</code>,
    },
    {
      key: "status",
      header: t("Status"),
      cell: (widget) => <span className={`status status-${widget.status}`}>{(statusLabel ?? t)(widget.status)}</span>,
    },
    {
      key: "actions",
      // Not converted to a `RowMenu` — this is the row's only action (see report: a menu
      // with one item is pure overhead over a direct button). Still labeled for
      // accessibility, matching `Roles.tsx`/`Users.tsx`'s existing pattern for an actions
      // column that isn't a bare `<th></th>`.
      headerLabel: t("Actions"),
      cell: (widget) => (
        <button
          onClick={() => requestTrash(widget)}
          {...agentHandle({ handle: `${rowHandleById.get(widget.id)}-trash` }, {
            role: "button",
            label: `Move "${widget.title}" to trash`,
          })}
        >
          {t("Trash")}
        </button>
      ),
    },
  ];
}

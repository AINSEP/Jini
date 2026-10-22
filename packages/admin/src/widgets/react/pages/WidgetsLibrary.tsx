import { useWidgetsLibraryView } from '../hooks/page-views.hooks.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';
import { type AdminWidgetType } from "../../models.js";

import { ConfirmDialog } from "../../../react/components/ConfirmDialog/ConfirmDialog.js";
import { DataTable } from "../../../react/components/DataTable.js";
import { agentHandle } from "@jini-ai/agentic";
import { widgetTypeLabel } from "../../rules.js";
import { useWiredWidgetsLibrary } from "../hooks/use-widgets-library.hooks.js";

/**
 * @file `WidgetsLibraryScreen` (`ui.spec.md` §2.1/§3.1/§4.1) — the widget library/list screen,
 * `/admin/widgets` — markup only. Mirrors `Menus.tsx`'s list-table/status-badge/header-action
 * shape exactly.
 *
 * State and the fetch live in `../hooks/use-widgets-library.hooks.ts`; the shared type-label
 * derivation lives in `../../rules.ts`. Delete always confirms first (`pendingTrash`/`ConfirmDialog`
 * below) and moves the widget to the Trash — there is no purge/force-purge escalation here any
 * more (2026-09-21, `trash-delete-architecture.md`): the server's widget purge route was removed,
 * a trashed widget is hidden from this list by the server, and the Trash screen owns
 * restore/purge from here.
 */
export interface WidgetsLibraryProps {
  /**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
  useWidgetsLibraryHook?: typeof useWiredWidgetsLibrary | undefined;
}

export { WidgetsLibraryNotices } from '../components/WidgetsLibraryNotices.js';
import { WidgetsLibraryNotices } from '../components/WidgetsLibraryNotices.js';

export function WidgetsLibrary({ useWidgetsLibraryHook = useWiredWidgetsLibrary }: WidgetsLibraryProps = {}) {
  const { widgetTypes, headerActions, statusLabel } = useWidgetsOptions();
  const {
    widgets,
    error,
    skippedCount,
    skippedIds,
    createType,
    setCreateType,
    pendingTrash,
    trashing,
    requestTrash,
    confirmTrash,
    cancelTrash,
    t,
    locale,
    rowHandleById,
  } = useWidgetsLibraryView({ useWidgetsLibraryHook });

  if (error && !widgets) return <div className="notice error">{error}</div>;
  if (!widgets) return <div className="notice">{t("Loading widgets…")}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t("Widgets")}</h1>
          <p className="page-description">
            {t("Create reusable content blocks and place them into your theme's widget regions.")}
          </p>
        </div>
        <div className="page-actions">
          {headerActions}
          <a
            href="/admin/widgets/regions"
            {...agentHandle({ handle: "widgets-regions-link" }, { role: "link", label: "Go to Widget Regions" })}
          >
            {t("Regions →")}
          </a>
          <select
            value={createType}
            onChange={(e) => setCreateType(e.target.value as AdminWidgetType)}
            aria-label={t("Widget type to create")}
            {...agentHandle({ handle: "widgets-create-type" }, { role: "field", label: "Widget type to create" })}
          >
            {widgetTypes.map((o) => (
              <option key={o.value} value={o.value}>
                {widgetTypeLabel({ widgetType: o.value, types: widgetTypes }, { t })}
              </option>
            ))}
          </select>
          <a
            className="btn-primary"
            href={`/admin/widgets/new?type=${createType}`}
            {...agentHandle({ handle: "widgets-add-new" }, { role: "link", label: "Create a new widget of the selected type" })}
          >
            {t("Add New")}
          </a>
        </div>
      </div>
      <WidgetsLibraryNotices error={error} skippedCount={skippedCount} skippedIds={skippedIds} t={t} />
      <DataTable
        rows={widgets}
        rowKey={(widget) => widget.id}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No widgets yet.")}</p>
              <p className="page-description">{t("Create one above to get started.")}</p>
            </div>
          </div>
        }
        columns={[
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
        ]}
      />
      <ConfirmDialog
        open={pendingTrash !== null}
        agentHandle="widgets-trash"
        title={t("Move to trash?")}
        body={pendingTrash ? <p>{t('Move "{title}" to trash?').replace("{title}", pendingTrash.title)}</p> : null}
        confirmLabel={t("Move to trash")}
        destructive
        pending={trashing}
        onConfirm={confirmTrash}
        onCancel={cancelTrash}
      />
    </div>
  );
}

export default WidgetsLibrary;

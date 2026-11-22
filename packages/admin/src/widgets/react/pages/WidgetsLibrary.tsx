import { useWidgetsLibraryView } from '../hooks/page-views.hooks.js';
import { TrashWidgetDialog } from '../components/TrashWidgetDialog.js';
import { widgetsLibraryColumns } from '../components/WidgetTableColumns.js';
import { WidgetsLibraryHeader } from '../components/WidgetPageHeaders.js';
import { useWidgetsOptions } from '../hooks/WidgetsPorts.hooks.js';
import { type AdminWidgetType } from "../../models.js";

import { DataTable } from "../../../react/components/DataTable.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
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
  useWidgetsLibraryViewHook?: typeof useWidgetsLibraryView | undefined;
  useWidgetsOptionsHook?: typeof useWidgetsOptions | undefined;
}

export { WidgetsLibraryNotices } from '../components/WidgetsLibraryNotices.js';
import { WidgetsLibraryNotices } from '../components/WidgetsLibraryNotices.js';

export function WidgetsLibrary({ useWidgetsLibraryHook = useWiredWidgetsLibrary, useWidgetsLibraryViewHook = useWidgetsLibraryView, useWidgetsOptionsHook = useWidgetsOptions }: WidgetsLibraryProps = {}) {
  const { widgetTypes, headerActions, statusLabel } = useWidgetsOptionsHook();
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
    rowHandleById,
  } = useWidgetsLibraryViewHook({ useWidgetsLibraryHook });

  if (error && !widgets) return <div className="notice error">{error}</div>;
  if (!widgets) return <div className="notice">{t("Loading widgets…")}</div>;

  return (
    <div className="page">
      <WidgetsLibraryHeader t={t} headerActions={headerActions} createType={createType} setCreateType={setCreateType} widgetTypes={widgetTypes} />
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
        columns={widgetsLibraryColumns({ t, widgetTypes, statusLabel, rowHandleById, requestTrash })}
      />
      <TrashWidgetDialog t={t} pendingTrash={pendingTrash} trashing={trashing} confirmTrash={confirmTrash} cancelTrash={cancelTrash} />
    </div>
  );
}

export default WidgetsLibrary;

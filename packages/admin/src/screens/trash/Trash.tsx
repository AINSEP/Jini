import { DataTable, type DataTableColumn } from "../../react/components/DataTable.js";
import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { InfoTip } from "@jini-ai/ui/admin-widgets";

import type { AdminTrashItemDto } from "@jini-ai/core/contracts/site/cms-trash";

import type { AdminNavLabelTranslator } from "../../shell/lib/admin-nav-i18n.js";
import type { Translate } from "@jini-ai/core/text";
import { actorLabel, coverageLine, entityTypeLabel, itemSubtitle } from "./rules.js";
import type { TrashController, TrashT } from "./hooks/use-trash.hooks.js";

import { formatTimestamp, interpolate } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
/**
 * @file The Trash screen — markup only. Every piece of state lives in `hooks/use-trash.hooks.ts`.
 *
 * Replaces the `soon: true` Placeholder `panels.tsx` rendered for this nav entry since the tab was
 * added. Design of record: `ADS-memory/reports/2026-09-20-trash-delete-architecture.md`.
 *
 * The coverage line under the title is not decoration and is not behind a disclosure: phase 1
 * collects four of the seven kinds this admin can delete, so a user who deletes a widget and does
 * not find it here would otherwise conclude it is gone for good.
 * Owner update (2026-10-07): the original always-visible coverage requirement above is superseded
 * by the Users title's shared InfoTip pattern, keeping exceptions discoverable with less intro copy.
 */

/** The Trash dictionary bound to one locale — what the Trash rules take as `translate`. */
function trashTranslator({ t, locale }: { t: TrashT; locale: string }, _optional = {}): Translate {
  return (key: string): string => t({ locale, key });
}

/** The select-all checkbox that lives in the table's first header cell. */
function SelectAllHeader(props: { locale: string; t: TrashT; allSelected: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <label className="jini-form-checkbox-field">
      <input
        type="checkbox"
        checked={props.allSelected}
        disabled={props.disabled}
        onChange={props.onToggle}
        {...agentHandle({ handle: "trash-select-all" }, {
          role: "checkbox",
          label: props.t({ locale: props.locale, key: "Select every item shown" }),
        })}
      />
      <span className="jini-visually-hidden">{props.t({ locale: props.locale, key: "Select every item shown" })}</span>
    </label>
  );
}

/** Builds the table's column descriptors. A plain function, not a hook-scoped closure. */
function trashColumns(props: {
  locale: string;
  t: TrashT;
  selected: ReadonlySet<string>;
  allSelected: boolean;
  anyRows: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  handleForRow: (id: string) => string;
  actorUsernames: ReadonlyMap<string, string>;
}): DataTableColumn<AdminTrashItemDto>[] {
  return [
    {
      key: "select",
      header: (
        <SelectAllHeader
          locale={props.locale}
          t={props.t}
          allSelected={props.allSelected}
          disabled={!props.anyRows}
          onToggle={props.onToggleAll}
        />
      ),
      headerLabel: props.t({ locale: props.locale, key: "Select every item shown" }),
      cell: (item) => (
        <label className="jini-form-checkbox-field">
          <input
            type="checkbox"
            checked={props.selected.has(item.id)}
            onChange={() => props.onToggle(item.id)}
            {...agentHandle({ handle: `${props.handleForRow(item.id)}-select` }, {
              role: "checkbox",
              label: interpolate({ template: props.t({ locale: props.locale, key: 'Select "{title}"' }), vars: { title: item.title } }),
            })}
          />
          <span className="jini-visually-hidden">{interpolate({ template: props.t({ locale: props.locale, key: 'Select "{title}"' }), vars: { title: item.title } })}</span>
        </label>
      ),
    },
    {
      key: "title",
      header: props.t({ locale: props.locale, key: "Title" }),
      cell: (item) => (
        <>
          <div>{item.title}</div>
          {itemSubtitle({ translate: trashTranslator({ t: props.t, locale: props.locale }), item }) ? <div className="jini-muted-cell">{itemSubtitle({ translate: trashTranslator({ t: props.t, locale: props.locale }), item })}</div> : null}
        </>
      ),
    },
    {
      key: "kind",
      header: props.t({ locale: props.locale, key: "Kind" }),
      cell: (item) => entityTypeLabel({ translate: trashTranslator({ t: props.t, locale: props.locale }), entity: item }),
    },
    {
      key: "deleted",
      header: props.t({ locale: props.locale, key: "Deleted" }),
      cell: (item) => formatTimestamp({ iso: item.trashedAt }, { viewerTimeZone: VIEWER_TIME_ZONE }),
    },
    {
      key: "actor",
      header: props.t({ locale: props.locale, key: "Deleted by" }),
      cell: (item) => {
        const actor = actorLabel({ translate: trashTranslator({ t: props.t, locale: props.locale }), item }, { knownUsernames: props.actorUsernames });
        // `title` is the plugin/agent id, as a tooltip — see `rules.ts`'s `actorLabel` doc for why
        // it no longer replaces the human-readable label outright.
        return actor.title ? <span title={actor.title}>{actor.label}</span> : actor.label;
      },
    },
    {
      key: "days",
      header: props.t({ locale: props.locale, key: "Days left" }),
      cell: (item) => item.daysRemaining,
    },
  ];
}

/** The toolbar: what the selection can have done to it. Both actions act on the SAME selection. */
function TrashToolbar(props: { controller: TrashController; selectedCount: number }) {
  const { controller, selectedCount } = props;
  const locale = controller.locale;
  const { t } = controller;
  const none = selectedCount === 0 || controller.busy;

  return (
    <div className="jini-toolbar jini-trash-toolbar" data-selection-empty={selectedCount === 0}>
      <span className="jini-muted-cell">
        {interpolate({ template: t({ locale: locale, key: "{count} selected" }), vars: { count: String(selectedCount) } })}
      </span>
      <button
        type="button"
        className="jini-btn-secondary"
        disabled={controller.refreshing || controller.busy}
        onClick={() => controller.refresh()}
        {...agentHandle({ handle: "trash-refresh" }, {
          role: "button",
          label: controller.refreshing ? t({ locale: locale, key: "Refreshing…" }) : t({ locale: locale, key: "Refresh" }),
        })}
      >
        {controller.refreshing ? t({ locale: locale, key: "Refreshing…" }) : t({ locale: locale, key: "Refresh" })}
      </button>
      <button
        type="button"
        className="jini-btn-secondary jini-trash-bulk-action"
        disabled={none}
        onClick={() => void controller.onRestoreSelected()}
        {...agentHandle({ handle: "trash-restore" }, { role: "button", label: t({ locale: locale, key: "Restore" }) })}
      >
        {t({ locale: locale, key: "Restore" })}
      </button>
      <button
        type="button"
        className="jini-btn-danger jini-trash-bulk-action"
        disabled={none}
        onClick={() => controller.setPurgeConfirmOpen(true)}
        {...agentHandle({ handle: "trash-purge" }, { role: "button", label: t({ locale: locale, key: "Delete permanently" }) })}
      >
        {t({ locale: locale, key: "Delete permanently" })}
      </button>
    </div>
  );
}

/** Loading / empty / populated, as a flat if-chain rather than nested ternaries. */
function TrashItemsView(props: { controller: TrashController }) {
  const { controller } = props;
  const locale = controller.locale;
  const { t } = controller;

  if (!controller.items) return controller.error ? null : <div className="jini-notice">{t({ locale: locale, key: "Loading the Trash…" })}</div>;
  if (controller.items.length === 0) {
    return (
      <div className="jini-card">
        <div className="jini-empty-state">
          <p>{t({ locale: locale, key: "The Trash is empty." })}</p>
        </div>
      </div>
    );
  }

  const rowHandles = buildAgentListHandles({ prefix: "trash-row", ids: controller.items.map((item) => item.id) }
  );
  const handleById = new Map(controller.items.map((item, index) => [item.id, rowHandles[index]]));

  return (
    <>
      <DataTable
        rows={controller.items}
        rowKey={(item) => item.id}
        columns={trashColumns({
          locale,
          t,
          selected: controller.selected,
          allSelected: controller.allSelected,
          anyRows: controller.items.length > 0,
          onToggle: controller.toggle,
          onToggleAll: controller.toggleAll,
          handleForRow: (id) => {
            const handle = handleById.get(id);
            if (handle === undefined) throw new Error(`trash item ${id} has no row handle`);
            return handle;
          },
          actorUsernames: controller.actorUsernames,
        })}
      />
      {controller.nextCursor ? (
        <button
          type="button"
          className="jini-btn-secondary"
          onClick={controller.loadMore}
          disabled={controller.loadingMore}
          {...agentHandle({ handle: "trash-load-more" }, { role: "button", label: t({ locale: locale, key: "Load more" }) })}
        >
          {controller.loadingMore ? t({ locale: locale, key: "Loading…" }) : t({ locale: locale, key: "Load more" })}
        </button>
      ) : null}
    </>
  );
}

/**
 * The permanent-deletion confirm modal. Stays mounted and is driven by `open`, the same shape
 * `@jini-ai/admin/comments/react`'s purge dialog uses.
 */
function TrashPurgeDialog(props: { controller: TrashController; selectedCount: number }) {
  const { controller, selectedCount } = props;
  const locale = controller.locale;
  const { t } = controller;
  return (
    <ConfirmDialog
      open={controller.purgeConfirmOpen}
      agentHandle="trash-purge-confirm"
      title={t({ locale: locale, key: "Delete permanently?" })}
      body={
        <p>
          {interpolate({ template: t({ locale: locale, key: "{count} item(s) will be deleted permanently. This cannot be undone." }), vars: {
            count: String(selectedCount),
          } })}
        </p>
      }
      confirmLabel={t({ locale: locale, key: "Delete permanently" })}
      tone="danger"
      pending={controller.busy}
      onConfirm={() => void controller.onPurgeConfirmed()}
      onCancel={() => controller.setPurgeConfirmOpen(false)}
    />
  );
}

/**
 * The Trash screen.
 *
 * `useTrashHook` is the DI seam every screen carries — a test mounts this component
 * with a controller built over a fake port instead of stubbing global `fetch`. Both props are required:
 * the host owns the controller binding and the bound sidebar-label translator.
 */
export interface TrashProps {
  useTrashHook: () => TrashController;
  translateAdminNavLabel: AdminNavLabelTranslator;
}

export function Trash({ useTrashHook, translateAdminNavLabel }: TrashProps) {
  const controller = useTrashHook();
  const locale = controller.locale;
  const { t } = controller;
  const selectedCount = controller.selected.size;

  return (
    <div className="jini-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{translateAdminNavLabel({ locale: locale, key: "Administration" })}</p>
          <h1 className="jini-page-title">
            {translateAdminNavLabel({ locale: locale, key: "Trash" })}
            {/* Originally not behind a disclosure, on purpose — see this file's header.
                Owner update (2026-10-07): use the Users title's InfoTip to shorten the intro. */}
            <InfoTip label={coverageLine({ translate: trashTranslator({ t, locale }) })} agentHandle="trash-coverage-info" />
          </h1>
          <p className="jini-page-description">
            {t({ locale: locale, key: "Deleted items are kept for 30 days." })}
          </p>
        </div>
      </div>

      {controller.error ? (
        <div className="jini-notice jini-notice-error" role="alert">
          {controller.error}
        </div>
      ) : null}
      {controller.notice ? <div className="jini-notice">{controller.notice}</div> : null}

      <TrashToolbar controller={controller} selectedCount={selectedCount} />
      <TrashItemsView controller={controller} />
      <TrashPurgeDialog controller={controller} selectedCount={selectedCount} />
    </div>
  );
}

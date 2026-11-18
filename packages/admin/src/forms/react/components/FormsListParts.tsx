import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { RowMenu } from '../../../react/components/RowMenu/RowMenu.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import type { ReactNode } from 'react';
import type { AdminFormDefinition } from '../../models.js';
import type { useFormsListView } from '../hooks/forms-view.hooks.js';

export type FormsListRow = ReturnType<typeof useFormsListView>["rows"][number];
type Translate = (key: string) => string;

/** Title block, the optional host slot and the "New form" link. */
export function FormsListHeader({ headerActions, t }: { headerActions: ReactNode; t: Translate }, _optional: Record<string, never> = {}) {
  return (
    <div
      className="page-header"
      {...agentHandle({ handle: "forms-header" }, { role: "region", label: "Forms list header — page title and the New form button" })}
    >
      <div className="page-header-text">
        <p className="page-kicker">{t("Content")}</p>
        <h1 className="page-title">{t("Forms")}</h1>
        <p className="page-description">{t("Manage the forms embedded across the site and their submissions.")}</p>
      </div>
      <div className="page-actions">
        {headerActions}
        {/* Plain `<a className="btn-primary">`, not a `<button>` nested inside an `<a>` (invalid
            HTML, undefined activation behaviour) — same `a.btn-*` mechanism `Dashboard.tsx`'s
            "View site ↗" already uses. */}
        <a
          className="btn-primary"
          href="/admin/forms/new"
          {...agentHandle({ handle: "forms-new" }, { role: "link", label: "Create a new form" })}
        >
          {t("New form")}
        </a>
      </div>
    </div>
  );
}

/** Table columns of the forms list: name link, slug, dates, field count and the row menu. */
export function formsListColumns({ t }: { t: Translate }, _optional: Record<string, never> = {}) {
  return [
    {
      key: "name",
      header: t("Name"),
      cell: (form: FormsListRow) => (
        <a
          href={`/admin/forms/${form.slug}`}
          {...agentHandle({ handle: `${form.rowHandle}-edit` }, {
            role: "link",
            label: "Open this form's editor",
          })}
        >
          {form.name}
        </a>
      ),
    },
    { key: "slug", header: t("Slug"), cell: (form: FormsListRow) => form.slug },
    {
      key: "dates",
      header: t("Created / Updated"),
      // One `<time>` per line (created, then updated — or one line when never edited). The
      // visible text is the bare short date; the event word lives in the hover title and the
      // screen-reader text only, since the header already names both events.
      cell: (form: FormsListRow) => (
        <span className="forms-dates">
          {form.dates.map((line) => (
            <time key={line.kind} className="forms-dates-line" dateTime={line.dateTime} title={line.label}>
              <span aria-hidden="true">{line.text}</span>
              <span className="visually-hidden">{line.label}</span>
            </time>
          ))}
        </span>
      ),
    },
    { key: "fields", header: t("Fields"), cell: (form: FormsListRow) => form.fields.length },
    {
      key: "actions",
      header: t("More"),
      cell: (form: FormsListRow) => (
        <RowMenu
          triggerLabel={form.menuLabel}
          agentHandle={`${form.rowHandle}-menu`}
          items={form.menuItems}
        />
      ),
    },
  ];
}

/** The "Move to trash?" confirmation for one form. */
export function FormsListDeleteDialog({ pendingDelete, rowSavingId, removeForm, cancelDelete, t }: {
  pendingDelete: AdminFormDefinition | null; rowSavingId: string | null; removeForm: () => void; cancelDelete: () => void; t: Translate;
}, _optional: Record<string, never> = {}) {
  return (
  <ConfirmDialog
    open={pendingDelete !== null}
    agentHandle="forms-delete"
    title={t("Move to trash?")}
    body={
      pendingDelete ? (
        <p>
          {t("Move")} &quot;{pendingDelete.name}&quot; {t("to trash? It will disappear from the site and from this list.")}
        </p>
      ) : null
    }
    confirmLabel={t("Move to trash")}
    destructive
    pending={pendingDelete !== null && rowSavingId === pendingDelete.id}
    onConfirm={removeForm}
    onCancel={cancelDelete}
  />
  );
}

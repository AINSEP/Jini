import type { ReactNode } from "react";
import { ConfirmDialog, DataTable } from "../../react/index.js";
import type { MenusController } from "./hooks/use-menus.hooks.js";

/**
 * @file Menus admin screens: list view (this file) + tree editor, wiring the ADR-029 `navigation`
 * backend into the admin UI.
 *
 * Every piece of state and every API call for this list lives in `hooks/use-menus.hooks.ts`; see
 * that file's header for why. What stays here is presentation only: columns, empty state, and the
 * confirm copy.
 */
export interface MenusProps {
  /** The list controller hook — REQUIRED. The host binds its wired `useMenus` (port, translator,
   *  request-error kit); tests pass a double. */
  useMenusHook: () => MenusController;
  /** The host's section publish control, rendered first in the header actions. */
  publishAction: ReactNode;
  /** The host's create-menu route. */
  newMenuHref: string;
  /** The host's edit route for one menu. */
  menuHref: (required: { slug: string }) => string;
}

export function Menus(props: MenusProps, _optional: Record<string, never> = {}) {
  const { publishAction, newMenuHref, menuHref } = props;
  const { menus, error, pendingTrash, trashing, requestTrash, confirmTrash, cancelTrash, t } = props.useMenusHook();

  if (error && !menus) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!menus) return <div className="jini-notice">{t("Loading menus…")}</div>;

  return (
    <div className="jini-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t("Content")}</p>
          <h1 className="jini-page-title">{t("Menus")}</h1>
          <p className="jini-page-description">{t("Build navigation menus for your theme's header and footer.")}</p>
        </div>
        <div className="jini-page-actions">
          {publishAction}
          <a className="jini-btn-primary" href={newMenuHref}>
            {t("Add New")}
          </a>
        </div>
      </div>
      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}
      <DataTable
        rows={menus}
        rowKey={(menu) => menu.id}
        empty={
          <div className="jini-card">
            <div className="jini-empty-state">
              <p>{t("No menus yet.")}</p>
              <p className="jini-page-description">{t("Create your first menu to get started.")}</p>
            </div>
          </div>
        }
        columns={[
          // Menus are live on save, with no draft/publication transition (Jini createMenu).
          // The stored status serves the trash lifecycle; it cannot report a publish workflow.
          { key: "title", header: t("Title"), cell: (menu) => <a href={menuHref({ slug: menu.slug })}>{menu.title}</a> },
          { key: "slug", header: "Slug", cell: (menu) => menu.slug },
          {
            key: "actions",
            headerLabel: t("Actions"),
            cell: (menu) => <button onClick={() => requestTrash(menu)}>{t("Trash")}</button>,
          },
        ]}
      />
      <ConfirmDialog
        open={pendingTrash !== null}
        title={t("Move to trash?")}
        body={pendingTrash ? <p>{t('Move "{title}" to trash?').replace("{title}", () => pendingTrash.title)}</p> : null}
        confirmLabel={t("Move to trash")}
        destructive
        pending={trashing}
        onConfirm={confirmTrash}
        onCancel={cancelTrash}
      />
    </div>
  );
}

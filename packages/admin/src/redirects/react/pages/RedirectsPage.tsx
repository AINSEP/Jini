import { DataTable } from '../../../react/components/DataTable.js';
import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { describeApiError } from '@jini-ai/core/admin-runtime';
import { ImportRedirectsForm } from '../components/ImportRedirectsForm.js';
import { CreateRedirectForm, RedirectsHeader } from '../components/CreateRedirectForm.js';
import { useWiredRedirects } from '../hooks/wired.hooks.js';
import { useRedirectsPage } from '../hooks/RedirectsPage.hooks.js';
/** Redirects list markup. The original fetch-query pilot rationale is retained in SOURCE-RATIONALE.md.
 * Controllers own local state; hooks bind query effects, table projections and the host's translator.
 * Locale is supplied once per scope, never fetched independently by each row.
 */

export interface RedirectsProps {
  /**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before. See `PostsProps.usePostsHook` for the full rationale.
   */
  useRedirectsHook?: typeof useWiredRedirects;
  useRedirectsPageHook?: typeof useRedirectsPage;
}

export function RedirectsPage({ useRedirectsHook = useWiredRedirects, useRedirectsPageHook = useRedirectsPage }: RedirectsProps = {}) {
  const { redirects, listStatus, listError, error, saving, pendingDelete,
    confirmDelete, deletePending, submitCreate, t, locale, columns, deleteBody, cancelDelete, headerActions } = useRedirectsPageHook({ useRedirectsHook });

  // Only a FIRST load blocks the screen. A refetch triggered by a write keeps
  // the table on screen (`status` stays `'success'`), where the old
  // `if (!redirects)` guard blanked the whole page after every single edit.
  if (listStatus === "error" && !redirects) {
    return <div className="notice error">{describeApiError({ e: listError, fallback: "failed to load redirects" })}</div>;
  }
  if (!redirects) return <div className="notice">{t("Loading redirects…")}</div>;

  return (
    <div className="page">
      <RedirectsHeader headerActions={headerActions} t={t} />
      {error ? <div className="notice error">{describeApiError({ e: error, fallback: "request failed" })}</div> : null}

      <CreateRedirectForm t={t} saving={saving} submitCreate={submitCreate} />

      <ImportRedirectsForm t={t} locale={locale} />

      {redirects.filter((rule) => rule.status === "active" && rule.matchType === "wildcard").length > 500 ? <div className="notice">{t("Only the first 500 active wildcard redirects are used. Turn off or merge some.")}</div> : null}
      <DataTable
        rows={redirects}
        rowKey={(rule) => rule.id}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t("No redirect rules yet.")}</p>
            </div>
          </div>
        }
        columns={columns}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        agentHandle="redirects-delete"
        title={t("Delete redirect rule?")}
        body={deleteBody}
        confirmLabel={t("Delete")}
        destructive
        pending={deletePending}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

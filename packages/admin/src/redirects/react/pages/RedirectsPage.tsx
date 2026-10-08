import { DataTable, ConfirmDialog } from '../../../react/index.js';
import { agentHandle } from '@jini-ai/agentic';
import { describeApiError } from '../../../core/transport/errors.js';
import { ImportRedirectsForm } from '../components/ImportRedirectsForm.js';
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
}

export function RedirectsPage({ useRedirectsHook = useWiredRedirects }: RedirectsProps = {}) {
  const { redirects, listStatus, listError, error, saving, pendingDelete,
    confirmDelete, deletePending, submitCreate, t, locale, columns, deleteBody, cancelDelete, headerActions } = useRedirectsPage({ useRedirectsHook });

  // Only a FIRST load blocks the screen. A refetch triggered by a write keeps
  // the table on screen (`status` stays `'success'`), where the old
  // `if (!redirects)` guard blanked the whole page after every single edit.
  if (listStatus === "error" && !redirects) {
    return <div className="notice error">{describeApiError({ e: listError, fallback: "failed to load redirects" })}</div>;
  }
  if (!redirects) return <div className="notice">{t("Loading redirects…")}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Marketing")}</p>
          <h1 className="page-title">{t("Redirects")}</h1>
          <p className="page-description">
            {t("Manual URL redirect rules. Rules created automatically from a slug change (source")}
            <code> auto_slug_change</code>
            {t(") also show up here.")}
          </p>
        </div>
        <div className="page-actions">
          {headerActions}
        </div>
      </div>
      {error ? <div className="notice error">{describeApiError({ e: error, fallback: "request failed" })}</div> : null}

      <form className="card form-measure" onSubmit={submitCreate}>
        <div className="field-group">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="redirect-match-type">{t("Match type")}</label>
              <select
                id="redirect-match-type"
                name="matchType"
                defaultValue="exact"
                {...agentHandle({ handle: "redirects-create-match-type" }, { role: "field", label: "New redirect's match type" })}
              >
                <option value="exact">{t("exact")}</option>
                <option value="prefix">{t("prefix")}</option>
                <option value="wildcard">{t("wildcard")}</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="redirect-from-pattern">{t("From path")}</label>
              <input
                id="redirect-from-pattern"
                name="fromPattern"
                placeholder="/old-path"
                required
                {...agentHandle({ handle: "redirects-create-from-pattern" }, { role: "field", label: "New redirect's source path or pattern" })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="redirect-to-target">{t("To target")}</label>
              <input
                id="redirect-to-target"
                name="toTarget"
                placeholder="/new-path or https://example.com/..."
                required
                {...agentHandle({ handle: "redirects-create-to-target" }, { role: "field", label: "New redirect's destination path or URL" })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="redirect-status-code">{t("Status code")}</label>
              <select
                id="redirect-status-code"
                name="statusCode"
                defaultValue="301"
                {...agentHandle({ handle: "redirects-create-status-code" }, { role: "field", label: "New redirect's HTTP status code" })}
              >
                <option value="301">{t("301 (permanent)")}</option>
                <option value="302">{t("302 (temporary)")}</option>
                <option value="307">{t("307 (temporary, method-preserving)")}</option>
                <option value="308">{t("308 (permanent, method-preserving)")}</option>
              </select>
            </div>
          </div>
        </div>
        <div className="editor-actions form-actions">
          <button
            type="submit"
            disabled={saving}
            {...agentHandle({ handle: "redirects-create-submit" }, { role: "button", label: "Add this redirect rule" })}
          >
            {saving ? t("Saving…") : t("Add redirect")}
          </button>
        </div>
      </form>

      <ImportRedirectsForm t={t} locale={locale} />

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

import { agentHandle } from '@jini-ai/core/agent-handles';
import type { FormEventHandler, ReactNode } from 'react';

type Translate = (key: string, options?: { serverLabel?: string }) => string;

/** Page title block and the host's header slot. */
export function RedirectsHeader({ headerActions, t }: { headerActions: ReactNode; t: Translate }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <p className="page-kicker">{t("Marketing")}</p>
        <h1 className="page-title">{t("Redirects")}</h1>
        <p className="page-description">
          {t("Manage URL redirects, including those created automatically when a page's address changes.")}
        </p>
      </div>
      <div className="page-actions">
        {headerActions}
      </div>
    </div>
  );
}

/** The HTTP status code select of the create form. */
function StatusCodeField({ t }: { t: Translate }) {
  return (
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
  );
}

/** The four inputs of the create-redirect form. */
function CreateRedirectFields({ t }: { t: Translate }) {
  return (
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
            <option value="exact">{t("exact", { serverLabel: "exact" })}</option>
            <option value="prefix">{t("prefix", { serverLabel: "prefix" })}</option>
            <option value="wildcard">{t("wildcard", { serverLabel: "wildcard" })}</option>
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
        <StatusCodeField t={t} />
      </div>
    </div>
  );
}

/** Create-redirect form: match type, from, to, status code and the submit button. */
export function CreateRedirectForm({ t, saving, submitCreate }: { t: Translate; saving: boolean; submitCreate: FormEventHandler<HTMLFormElement> }) {
  return (
    <form className="card form-measure" onSubmit={submitCreate}>
      <CreateRedirectFields t={t} />
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
  );
}

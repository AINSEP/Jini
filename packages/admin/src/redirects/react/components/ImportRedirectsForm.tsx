import { agentHandle } from '@jini-ai/agentic';
import type { RedirectsTranslate as Translate } from '../../models.js';
import { useWiredImportRedirectsForm } from '../hooks/wired.hooks.js';
export interface ImportRedirectsFormProps {
  /** Bound translator, threaded down from `Redirects`'s own hook rather than resolved here — see
   *  this file's header. */
  t: Translate;
  /** Raw resolved locale — needed alongside `t` because the host may resolve locale-specific message fragments. See this file's header. */
  locale: string;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useImportRedirectsFormHook?: typeof useWiredImportRedirectsForm;
}

/** Bulk-import affordance (REQ-04) — paste a JSON array of rule objects, submit through
 * `api.importRedirects`, and surface the `207` per-item created/failed breakdown directly
 * (never collapsed into a single pass/fail toast — a partial-batch failure is the route's own
 * designed behavior, not an edge case). */
export function ImportRedirectsForm({ t, locale, useImportRedirectsFormHook = useWiredImportRedirectsForm }: ImportRedirectsFormProps) {
  const { raw, error, result, importing, submit, changeRaw, rulesLabel, resultSummary, createdText, failedLabel } = useImportRedirectsFormHook({ t, locale });

  return (
    <details className="notice redirects-import form-measure">
      <summary>{t("Bulk import")}</summary>
      <form onSubmit={submit}>
        <label htmlFor="redirects-import-json">
          {rulesLabel}
        </label>
        <textarea
          id="redirects-import-json"
          rows={6}
          value={raw}
          onChange={changeRaw}
          placeholder='[{"matchType":"exact","fromPattern":"/old","toTarget":"/new","statusCode":301}]'
          {...agentHandle({ handle: "redirects-import-json" }, { role: "field", label: "JSON array of redirect rules to bulk-import" })}
        />
        {/* Secondary, not primary — "Add redirect" above is this screen's one actual create
            action; bulk import is a power-user path to the same result, not a second headline CTA
            competing with it. */}
        <button
          type="submit"
          className="btn-secondary"
          disabled={importing}
          {...agentHandle({ handle: "redirects-import-submit" }, { role: "button", label: "Import the pasted redirect rules" })}
        >
          {importing ? t("Importing…") : t("Import")}
        </button>
      </form>
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      {result ? (
        <div className="redirects-import-result">
          <p>{resultSummary}</p>
          {result.created.length > 0 ? (
            <ul>
              {result.created.map((r) => (
                <li key={r.id}>
                  <span className="save-ok">{createdText}</span> {r.fromPattern} → {r.toTarget}
                </li>
              ))}
            </ul>
          ) : null}
          {result.failed.length > 0 ? (
            <ul>
              {result.failed.map((f) => (
                <li key={f.index}>
                  <span className="save-error">{failedLabel(f)}</span>: {f.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}


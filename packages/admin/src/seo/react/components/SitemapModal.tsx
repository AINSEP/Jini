import { agentHandle } from "@jini-ai/agentic";
import { Dialog } from "@jini-ai/ui-kit/react";
import { formatTimestamp } from "@jini-ai/ui/panel-kit";



import { useSeoCopy, useSeoOptions } from "../hooks/SeoPorts.hooks.js";
import { actionLabel } from "../../rules.js";
import { useWiredSitemapModal, type SitemapModalController } from "../hooks/use-sitemap-modal.hooks.js";
import { useSitemapModalRegenerate, useSitemapPresentation, useSitemapTable, useSitemapViewToggle } from "../hooks/SitemapModal.hooks.js";


/**
 * `SitemapModal` — "View sitemap" (owner request, `react/pages/SeoPage.tsx`'s Sitemap card). Reads the exact same
 * `GET /sitemap.xml` bytes a crawler gets (`sitemap-dependencies.hooks.ts`'s `defaultSitemapPort`,
 * via `siteUrl()`) and renders them as a filterable `URL | Last modified` table, with a Raw XML
 * toggle for verifying the literal response text. `changefreq`/`priority` columns were considered
 * and dropped: `server/inbound/public-http/routes/site/sitemap.ts` never emits either field (read
 * directly, not guessed), so a column for them would only ever show blank.
 *
 * Jini's Dialog owns modality and focus confinement: aria-modal promises the background cannot
 * be reached with Tab. `.sitemap-modal` widens the shared chrome to about 900px; its body is the
 * single scrolling region between fixed header and footer.
 *
 * Domain state (fetch, parse, filter, view toggle) lives in `hooks/use-sitemap-modal
 * .hooks.ts`; this file is markup only — the one bit of sequencing that belongs to neither that
 * hook nor the outer `useSeo()` (refetching after a successful regenerate) lives in its own
 * colocated `react/hooks/SitemapModal.hooks.ts`, see that file's header for why it isn't folded into either.
 *
 * ## Agent handles
 * Every interactive element carries its own `agentHandle` (grep `agentHandle(` in `react/pages/SeoPage.tsx` for
 * the convention this follows): the raw-XML link, the table/raw toggle, the filter box, each row's
 * URL link (namespaced via `buildAgentListHandles`, the same per-item scheme `MediaPickerDialog
 * .tsx` uses), the footer Regenerate button, and the footer Close button.
 */

export interface SitemapModalProps {
  locale: string;
  /** `settings.sitemapEnabled` from `useSeo()` — when `false`, the modal shows why instead of a
   *  table (REQ 8: "disabled" and "on but zero URLs" are different facts, so this never fetches to
   *  find out — it already knows).
   *
   *  Threaded into `useSitemapModal` as `SitemapModalInputs.enabled` so the fetch, header and Raw XML
   *  toggle all agree with the disabled body. */
  sitemapEnabled: boolean;
  /** `saving` from `useSeo()` — shared with the outer page's own Save/Regenerate buttons, same as
   *  today's single-flag convention (`react/pages/SeoPage.tsx`'s existing `disabled={saving}` on both). */
  regenerating: boolean;
  /** `regenerateSitemap` from `useSeo()`. Resolves `true` on success, `false` on a caught failure —
   *  `handleRegenerate` below only refetches on `true`, matching REQ 7 ("after a SUCCESSFUL
   *  regenerate it refetches"). */
  onRegenerate: () => Promise<boolean>;
  onClose: () => void;
  /** Injectable seam for the modal's fetch/parse/filter/view state. Defaults to the real
   *  {@link useWiredSitemapModal}; a test can pass a fake here to exercise this component's
   *  rendering against a fixed `SitemapModalController`. */
  useModal?: typeof useWiredSitemapModal;
}

/** The header's raw-XML link + table/raw toggle — only shown once there is a real response to
 *  point at (REQ 3/6). Its own component purely so {@link SitemapModal} stays a flat sequence of
 *  blocks.
 *
 * @complexity O(1). */
function SitemapModalHeaderActions({ locale, modal }: { locale: string; modal: SitemapModalController }) {
  const { sourceUrl } = useSitemapPresentation({ locale, modal });
  const { toggleView } = useSitemapViewToggle({ modal });
  const t = useSeoCopy();
  return (
    <div className="sitemap-modal-header-actions">
      <a
        className="sitemap-modal-source-link"
        href={sourceUrl}
        target="_blank"
        rel="noreferrer"
        {...agentHandle({ handle: "seo-sitemap-open-raw-link" }, {
          role: "link",
          label: "Open the real sitemap.xml file in a new tab",
        })}
      >
        {t({ locale: locale, key: "sitemap.xml ↗" })}
      </a>
      {modal.status === "ready" ? (
        <button
          type="button"
          className="btn-secondary"
          aria-pressed={modal.view === "raw"}
          onClick={toggleView}
          {...agentHandle({ handle: "seo-sitemap-raw-toggle" }, {
            role: "button",
            label: "Toggle between the parsed table and the raw XML response",
          })}
        >
          {modal.view === "raw" ? t({ locale: locale, key: "Table" }) : t({ locale: locale, key: "Raw XML" })}
        </button>
      ) : null}
    </div>
  );
}

/** The parsed-table view: filter box + `URL | Last modified` table, or the empty-filter/empty-
 *  sitemap notices in place of a table with nothing to show. Its own component for the same
 *  flat-sequence-of-blocks reason as {@link SitemapModalHeaderActions}.
 *
 * @complexity O(1) to render — `entries`/`filteredEntries` are already computed by
 *   `useSitemapModal` (memoized there), this only maps them to JSX. */
function SitemapModalTable({ locale, modal }: { locale: string; modal: SitemapModalController }) {
  const t = useSeoCopy();
  const { formatDate = formatTimestamp } = useSeoOptions();
  const { rowHandles } = useSitemapTable({ modal });
  if (modal.entries.length === 0) return <div className="notice">{t({ locale: locale, key: "The sitemap has no URLs yet." })}</div>;



  return (
    <>
      <input
        type="search"
        className="sitemap-modal-filter"
        aria-label={t({ locale: locale, key: "Filter sitemap URLs" })}
        placeholder={t({ locale: locale, key: "Filter by URL…" })}
        value={modal.filter}
        onChange={(e) => modal.setFilter(e.target.value)}
        {...agentHandle({ handle: "seo-sitemap-filter" }, {
          role: "field",
          label: "Narrow the sitemap table by a substring match on the URL",
        })}
      />
      {modal.filteredEntries.length === 0 ? (
        <p className="muted-cell">{t({ locale: locale, key: "No URLs match this filter." })}</p>
      ) : (
        <div className="table-scroll">
          <table className="list-table">
            <thead>
              <tr>
                <th>{t({ locale: locale, key: "URL" })}</th>
                <th>{t({ locale: locale, key: "Last modified" })}</th>
              </tr>
            </thead>
            <tbody>
              {modal.filteredEntries.map((entry, index) => (
                <tr key={entry.loc}>
                  <td>
                    <a
                      href={entry.loc}
                      target="_blank"
                      rel="noreferrer"
                      {...agentHandle({ handle: rowHandles[index]! }, { role: "link", label: "Open this URL on the live site" })}
                    >
                      {entry.loc}
                    </a>
                  </td>
                  <td>{entry.lastmod === null ? <span className="muted-cell">{t({ locale: locale, key: "—" })}</span> : formatDate({ iso: entry.lastmod })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** The body's content-status switch (REQ 8/9: disabled, loading, error, then raw-vs-table) — kept
 *  as its own flat sequence of guards rather than a nested ternary inline in {@link SitemapModal}.
 *
 * @complexity O(1) — delegates the actual list rendering to {@link SitemapModalTable}. */
function SitemapModalBody({
  locale,
  sitemapEnabled,
  modal,
}: {
  locale: string;
  sitemapEnabled: boolean;
  modal: SitemapModalController;
}) {
  const t = useSeoCopy();
  if (!sitemapEnabled) {
    return (
      <div className="notice">
        {t({ locale: locale, key: 'Sitemap is off. Turn on "Sitemap enabled" above to publish one.' })}
      </div>
    );
  }
  if (modal.status === "loading") return <div className="notice">{t({ locale: locale, key: "Loading sitemap…" })}</div>;
  if (modal.status === "error") {
    return (
      <div className="notice error" role="alert">
        {modal.error}
      </div>
    );
  }
  if (modal.view === "raw") return <pre className="sitemap-modal-raw">{modal.xmlText}</pre>;
  return <SitemapModalTable locale={locale} modal={modal} />;
}

export function SitemapModal({
  locale,
  sitemapEnabled,
  regenerating,
  onRegenerate,
  onClose,
  useModal = useWiredSitemapModal,
}: SitemapModalProps, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const modal = useModal({ enabled: sitemapEnabled, onClose });
  const { title } = useSitemapPresentation({ locale, modal });
  const { handleRegenerate } = useSitemapModalRegenerate({ onRegenerate, refetch: modal.refetch });
  // Native modality keeps Tab from reaching the background, as MediaPickerDialog now does too.

  return (
    <Dialog open title={title} onClose={() => onClose()}
      className="settings-dialog tovu-domain-dialog sitemap-modal">
        <div className="sitemap-modal-header">
          <SitemapModalHeaderActions locale={locale} modal={modal} />
        </div>

        <div className="sitemap-modal-body">
          <SitemapModalBody locale={locale} sitemapEnabled={sitemapEnabled} modal={modal} />
        </div>

        <div className="widget-picker-footer">
          <span className="editor-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRegenerate}
              disabled={regenerating}
              {...agentHandle({ handle: "seo-sitemap-modal-regenerate" }, {
                role: "button",
                label: "Rebuild the cached sitemap and refresh this view",
              })}
            >
              {actionLabel({ pending: regenerating, pendingLabel: t({ locale: locale, key: "Working…" }), idleLabel: t({ locale: locale, key: "Regenerate sitemap" }) })}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              data-jini-autofocus=""
              {...agentHandle({ handle: "seo-sitemap-modal-close" }, { role: "button", label: "Close the sitemap viewer" })}
            >
              {t({ locale: locale, key: "Close" })}
            </button>
          </span>
        </div>
    </Dialog>
  );
}

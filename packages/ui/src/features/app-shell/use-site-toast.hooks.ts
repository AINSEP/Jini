/**
 * @file The "new site" toast: one at a time, and it outlives the page that made the site, because
 * every path that makes one leaves that page. Every word it shows is the host's (injected `copy`).
 */
import { useCallback, useEffect, useState } from 'react';

/** `note` is one short line; `items` is the full list behind it, shown on request. */
export interface SiteToast { message: string; note?: string; items?: readonly string[] }

/** The host's wording for each announcement. */
export interface SiteToastCopy {
  created: (input: { displayName: string }) => string;
  added: (input: { displayName: string }) => string;
  /** The one-line note on an import that kept `count` (> 0) items off or set them aside. */
  setAside: (input: { count: number }) => string;
}

export const AUTO_HIDE_MS = 5000;
/** Long enough to read what was kept off or left out. */
export const AUTO_HIDE_WITH_NOTE_MS = 12000;

/** How long a toast stays: a note or a list gets at least {@link AUTO_HIDE_WITH_NOTE_MS}. */
export function toastLifetime({ toast, autoHideMs }: { toast: SiteToast; autoHideMs: number }, _optional = {}): number {
  return (toast.note || toast.items) ? Math.max(autoHideMs, AUTO_HIDE_WITH_NOTE_MS) : autoHideMs;
}

/**
 * @param required.lastCreated the host's latest created site (its create flow's result), so that
 *   path needs no call here.
 * @param required.copy the host's wording; pass a stable (module-level) object.
 * @returns the toast to show, `dismiss`, and the announcers for the two paths that do not go
 *   through the host's create flow.
 * @complexity O(1) per toast: one state value and one timer.
 */
export function useSiteToast(
  { lastCreated, copy }: { lastCreated: { displayName: string } | null; copy: SiteToastCopy },
  { autoHideMs = AUTO_HIDE_MS }: { autoHideMs?: number } = {},
) {
  const [toast, setToast] = useState<SiteToast | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => { if (lastCreated) setToast({ message: copy.created(lastCreated) }); }, [lastCreated, copy]);
  useEffect(() => {
    if (toast === null) return undefined;
    const timer = setTimeout(() => setToast(null), toastLifetime({ toast, autoHideMs }));
    return () => clearTimeout(timer);
  }, [toast, autoHideMs]);

  const announceImported = useCallback((site: { displayName: string; warnings: readonly string[] }) => {
    const count = site.warnings.length;
    // Each notice stays whole in `items`; the toast itself only counts them.
    setToast({ message: copy.created(site), ...(count > 0 ? { note: copy.setAside({ count }), items: site.warnings } : {}) });
  }, [copy]);
  /** A folder is added rather than made, and one already on the list has its own notice. */
  const announceAdded = useCallback((site: { displayName: string; alreadyTracked?: boolean }) => {
    if (!site.alreadyTracked) setToast({ message: copy.added(site) });
  }, [copy]);

  return { toast, dismiss, announceImported, announceAdded, showToast: setToast };
}

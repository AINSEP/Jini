import { useCallback } from "react";

import { t as dictionaryT } from "../import-export-i18n.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The Import & Export panel's bound translator and its "may the Import tab make a new site"
 * rule. Host seam: the locale hook, the desktop-shell check and the cached sites read arrive on a
 * REQUIRED `host`, so this file reaches neither the host's locale query nor its sites client. Pass a
 * module-level `host` object: its hook fields are called on every render and must keep their identity.
 */

/** What {@link useImportExportTranslate} needs from the host. */
export interface ImportExportTranslateHost {
  /** The admin's resolved locale (a hook). */
  useLocale: () => string;
}

/** This panel's `t`, bound to the admin's resolved locale — the one place it reads the locale, same
 *  split as the Sites screen's wired hook. @complexity O(1) per lookup. */
export function useImportExportTranslate({ host }: { host: ImportExportTranslateHost }, _optional: Record<string, never> = {}): Translate {
  const locale = host.useLocale();
  return useCallback((key: string): string => dictionaryT({ locale: locale, key: key }), [locale]);
}

/** The slice of the host's cached sites read this rule looks at. */
export interface SitesSectionSnapshot {
  data?: { switchingEnabled?: boolean } | undefined;
  error?: unknown;
}

/** What {@link useSitesSectionAvailable} needs from the host. */
export interface SitesSectionAvailabilityHost {
  /** Whether this admin runs in the desktop shell, which never has a Sites section. */
  isDesktop: () => boolean;
  /** The host's shared, cached sites read (a hook); `enabled: false` must not request. */
  useSitesSnapshot: (required: { enabled: boolean }) => SitesSectionSnapshot;
}

/**
 * Whether this deployment has a Sites section, so the Import tab may make a new site for a live
 * website (until 2026-11-10 it linked to the New site tab instead).
 * The same rule the host's site-section availability hook applies to the sidebar and router —
 * never in the desktop shell, otherwise the server's `switchingEnabled` — over the same cached read
 * (the boot scope's principal key is the one the app root passes), so it costs no extra request. A read still
 * loading counts as no: an offer that fails is worse than one that shows a moment late.
 * A failed refresh counts as no too, even over cached data, because the router then gates Sites off.
 * @complexity O(1) plus the shared, cached sites read; none in the desktop shell.
 */
export function useSitesSectionAvailable(
  { host }: { host: SitesSectionAvailabilityHost },
  { desktop = host.isDesktop() }: { desktop?: boolean } = {},
): boolean {
  const snapshot = host.useSitesSnapshot({ enabled: !desktop });
  return !desktop && !snapshot.error && snapshot.data?.switchingEnabled === true;
}

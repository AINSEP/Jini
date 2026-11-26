import type { ButtonHTMLAttributes, ComponentProps, ElementType } from "react";
import { StoragePanel } from "./StoragePanel.js";
import type { StorageClient } from "./api/storage-api.js";
import type { ScreenshotCleanupClient } from "./api/screenshot-cleanup-api.js";
import type { useWiredStorage, StorageLink } from "./hooks/use-storage.hooks.js";
import type { useScreenshotCleanup } from "./hooks/use-screenshot-cleanup.hooks.js";
import { ScreenshotCleanupSection } from "./ScreenshotCleanupSection.js";

/**
 * @file Storage screen (P11 ST-17) — the `/admin/storage` route. Composes Jini's `StoragePanel` with
 * this admin's storage client, kit, copy and domain links, plus the screenshot "delete older than"
 * preview. Compaction and other ST-7b recovery actions are deliberately absent: no verified stopped-site
 * capability exists yet, and this screen never offers a writable shortcut against the running site.
 */


export interface StorageScreenProps {
  kit: { Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>> };
  links: readonly StorageLink[];
  copy: ComponentProps<typeof StoragePanel>["copy"];
  t: Parameters<typeof useWiredStorage>[0]["t"];
  categoryLabels: Parameters<typeof useWiredStorage>[0]["categoryLabels"];
  kindLabels: Parameters<typeof useWiredStorage>[0]["kindLabels"];
  screenshotAgeDays: number; screenshotsAnchor: string; screenshotHeading: string;
  client: StorageClient;
  screenshotClient: ScreenshotCleanupClient;
  /** Reports a failed request and answers the plain words to show. */
  reportErrors: (required: { error: unknown }) => string;
  now: () => number;
  locale: string;
  /** Required hooks (no default real hooks): the composition passes `useWiredStorage` and `useScreenshotCleanup`. */
  useWiredStorageHook: typeof useWiredStorage;
  useScreenshotCleanupHook: typeof useScreenshotCleanup;
}

/** The Storage screen over injected clients, clock and locale; {@link Storage} binds the live ones. */
export function StorageScreen({ client, screenshotClient, reportErrors, now, locale, useWiredStorageHook, useScreenshotCleanupHook, kit: { Button: KitButton }, links, copy, t, categoryLabels, kindLabels, screenshotAgeDays, screenshotsAnchor, screenshotHeading }: StorageScreenProps, _optional: Record<string, never> = {}) {
  const useStorage = () => useWiredStorageHook({ client, reportErrors, locale, links, t, categoryLabels, kindLabels }, {});
  // The same `.jini-page` / `.jini-page-header` / `.jini-page-title` frame as Trash and Media: without it the
  // page opened on bare section headings with no title (live-found 2026-11-25).
  return <div className="jini-page">
    <div className="jini-page-header">
      <div className="jini-page-header-text">
        <h1 className="jini-page-title">{t({ locale, key: "Storage" })}</h1>
      </div>
    </div>
    <StoragePanel useStorage={useStorage} kit={{ Button: KitButton }} copy={copy} links={links} />
    <ScreenshotCleanupSection client={screenshotClient} reportErrors={reportErrors} now={now} locale={locale} useScreenshotCleanupHook={useScreenshotCleanupHook} Button={KitButton} t={t} screenshotAgeDays={screenshotAgeDays} screenshotsAnchor={screenshotsAnchor} screenshotHeading={screenshotHeading} />
  </div>;
}


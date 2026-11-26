import type { ButtonHTMLAttributes, ElementType } from "react";
import type { ScreenshotCleanupClient } from "./api/screenshot-cleanup-api.js";
import type { useScreenshotCleanup } from "./hooks/use-screenshot-cleanup.hooks.js";
import { formatBytes, type useWiredStorage } from "./hooks/use-storage.hooks.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function ScreenshotCleanupSection({ client, reportErrors, now, locale, useScreenshotCleanupHook, Button: KitButton, screenshotAgeDays, screenshotsAnchor, screenshotHeading, t }: { useScreenshotCleanupHook: typeof useScreenshotCleanup; client: ScreenshotCleanupClient; reportErrors: (required: { error: unknown }) => string; now: () => number; locale: string; Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>>; screenshotAgeDays: number; screenshotsAnchor: string; screenshotHeading: string; t: Parameters<typeof useWiredStorage>[0]["t"] }, _optional = {}) {
  const screenshots = useScreenshotCleanupHook({ client, describeError: reportErrors }, {});
  const { state } = screenshots;
  return <section id={screenshotsAnchor} className="jini-card">
    <h2 className="jini-card-title">{t({ locale, key: screenshotHeading })}</h2>
    {state.status === "idle" || state.status === "error" || state.status === "done"
      ? <KitButton type="button" onClick={() => { void screenshots.preview({ before: now() - screenshotAgeDays * DAY_MS }); }}>{t({ locale, key: "Show what would be deleted" })}</KitButton> : null}
    {state.status === "shown" ? <>
      <p>{state.preview.count} · {formatBytes({ bytes: state.preview.bytes, locale, t })}</p>
      <ul>{state.preview.items.map(item => <li key={item}>{item}</li>)}</ul>
      <KitButton type="button" onClick={() => { void screenshots.confirm(); }}>{t({ locale, key: "Delete these screenshots" })}</KitButton>
    </> : null}
    {state.status === "done" ? <p role="status">{t({ locale, key: "Deleted" })}: {state.result.deleted.length} · {t({ locale, key: "Kept" })}: {state.result.kept.length}</p> : null}
    {state.status === "error" ? <p role="alert">{state.message}</p> : null}
  </section>;
}


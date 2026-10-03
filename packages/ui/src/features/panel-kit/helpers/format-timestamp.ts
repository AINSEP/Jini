/**
 * Centralize the historical fixed-width display so formatting changes have one owner. Preserve
 * the stored timestamp's prefix byte for byte: no parsing, locale formatting or timezone conversion.
 * Trailing seconds, milliseconds and zone suffix are intentionally dropped; callers supply ISO text.
 */
/** Render the ISO prefix as YYYY-MM-DD HH:MM without timezone conversion. */
export function formatTimestamp({ iso }: { iso: string }): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** Inject 'now' to keep relative-time display deterministic. The fallback wording uses simple
 * English singular/plural templates; hosts can translate them, but this is not full locale pluralization. */
export function formatRelativeMinutesAgo({ iso, nowMs }: { iso: string; nowMs: number }, { translate = (key) => key }: { translate?: ((key: string) => string) | undefined } = {}): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return translate("less than a minute ago");
  if (minutes === 1) return translate("1 minute ago");
  return translate("{minutes} minutes ago").replace(/\{minutes\}/g, String(minutes));
}

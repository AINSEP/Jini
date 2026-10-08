/**
 * Centralize the fixed-width display so formatting changes have one owner. The default
 * preserves the stored timestamp's prefix byte for byte, without parsing or timezone conversion.
 * Trailing seconds, milliseconds and zone suffix are intentionally dropped; callers supply ISO text.
 */
/** Render YYYY-MM-DD HH:MM; hosts can select the viewer's local timezone explicitly. */
export function formatTimestamp({ iso }: { iso: string }, { timeZone = "stored" }: { timeZone?: "stored" | "local" } = {}): string {
  if (timeZone === "local") {
    // A stored UTC prefix can label server time as viewer time (Tovu D-06). Local getters
    // follow the browser's timezone and DST; zone-less ISO is already local wall time.
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso; // Keep malformed source data visible.
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
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


/**
 * Centralize the fixed-width display so formatting changes have one owner. The default
 * preserves the stored timestamp's prefix byte for byte, without parsing or timezone conversion.
 * Trailing seconds, milliseconds and zone suffix are intentionally dropped; callers supply ISO text.
 */
/** Render YYYY-MM-DD HH:MM; hosts select viewer-local display by passing the viewer's IANA zone.
 * Core stays pure: the host resolves that zone at its own boundary, so equal arguments always render equally.
 * @throws RangeError when `viewerTimeZone` is not a known IANA zone. */
export function formatTimestamp({ iso }: { iso: string }, { viewerTimeZone }: { viewerTimeZone?: string | undefined } = {}): string {
  return viewerTimeZone === undefined ? storedPrefix(iso) : formatInZone({ iso, timeZone: viewerTimeZone });
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/;
const ISO_ZONE_SUFFIX = /^(?:Z|[+-]\d{2}:?\d{2})$/i;

/** "wall" = zone-less ISO date-time (already a wall-clock time); "instant" = ISO date-only (UTC by the
 * ECMAScript spec) or date-time with an explicit Z/offset; "text" = anything Date would parse host-locally. */
function isoKind(iso: string): "wall" | "instant" | "text" {
  if (ISO_DATE_ONLY.test(iso)) return "instant";
  const dateTime = ISO_DATE_TIME_PREFIX.exec(iso)?.[0];
  if (dateTime === undefined) return "text";
  const zone = iso.slice(dateTime.length);
  if (zone === "") return "wall";
  return ISO_ZONE_SUFFIX.test(zone) ? "instant" : "text";
}

function storedPrefix(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** A stored UTC prefix can label server time as viewer time, so absolute instants
 * are converted with Intl into the given zone, which also follows that zone's DST. Zone-less ISO is
 * already local wall time; other text would be parsed in the host's ambient zone, so it stays as given. */
function formatInZone({ iso, timeZone }: { iso: string; timeZone: string }, _options = {}): string {
  const kind = isoKind(iso);
  if (kind === "wall") return storedPrefix(iso);
  const date = new Date(iso);
  if (kind === "text" || Number.isNaN(date.getTime())) return iso; // Keep malformed source data visible.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** Inject 'now' to keep relative-time display deterministic. The fallback wording uses simple
 * English singular/plural templates; hosts can translate them, but this is not full locale pluralization. */
export function formatRelativeMinutesAgo({ iso, nowMs }: { iso: string; nowMs: number }, { translate = (key) => key }: { translate?: ((key: string) => string) | undefined } = {}): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return translate("less than a minute ago");
  if (minutes === 1) return translate("1 minute ago");
  return translate("{minutes} minutes ago").replace(/\{minutes\}/g, String(minutes));
}


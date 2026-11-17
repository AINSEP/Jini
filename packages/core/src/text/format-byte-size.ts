/**
 * @file A byte count as a short display label. 1024-based so the label agrees with upload limits.
 * Whole B/KB, one decimal from MB up, so two similarly sized files do not collapse to the same
 * whole-number size. Pure: the locale only controls the decimal separator, never a hardcoded dot.
 */

/** Optional presentation: the locale of the decimal separator, and the megabyte unit label. */
export interface FormatByteSizeOptions {
  /** BCP 47 locale for the decimal separator. Defaults to `en-US`. */
  locale?: string | undefined;
  /** Unit label for the megabyte band (a host that prefers `MiB` passes it). Defaults to `MB`. */
  megabyteLabel?: string | undefined;
}

/**
 * @param required.bytes - Size in bytes; fractions round to the nearest whole B/KB.
 * @param optional.locale - Locale for the decimal separator.
 * @param optional.megabyteLabel - Unit label for the megabyte band.
 * @returns `823 B`, `820 KB`, `9.5 MB` or `1.2 GB`.
 * @complexity O(1).
 */
export function formatByteSize(
  { bytes }: { bytes: number },
  { locale = 'en-US', megabyteLabel = 'MB' }: FormatByteSizeOptions = {},
): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mb = kb / 1024;
  return mb < 1024 ? `${decimal.format(mb)} ${megabyteLabel}` : `${decimal.format(mb / 1024)} GB`;
}

/**
 * @file Byte-count label shared by the composer's attachment chip (`AttachmentTray.tsx`) and the
 * preview modal's metadata view. Its own file so the preview modal does not import the tray, which
 * itself renders the preview modal.
 */

/** Formats optional byte counts for the compact composer attachment chip. */
export function formatAttachmentSize({ size }: { size: number | undefined }): string | null {
  if (size === undefined || !Number.isFinite(size) || size < 0) return null;
  if (size < 1_024) return `${Math.round(size)} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = size / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const formatted = value < 10 ? value.toFixed(1).replace(/\.0$/u, '') : Math.round(value).toString();
  return `${formatted} ${units[unitIndex]}`;
}

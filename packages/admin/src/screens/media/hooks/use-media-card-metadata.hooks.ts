import { formatByteSize } from "@jini-ai/core/text";
import { formatUploadDate } from "../../../media/rules.js";

/** Jini owns generic formatting; this hook only adapts the legacy card's view model. */
export interface MediaMetadataFormatters {
  formatByteSize: (required: { bytes: number }, optional?: { locale?: string }) => string;
  formatUploadDate?: (required: { createdAt: string }, optional?: { locale?: string; viewerTimeZone?: string | undefined }) => string | null;
}

/** The structural slice of the host's media item this hook reads; the host's wire DTO stays with the host. */
export interface MediaCardMetadataSource {
  byteSize?: number | null | undefined;
  createdAt: string;
}

// The byte-size label lives in `@jini-ai/core/text` (moved out of `@jini-ai/admin/media`, which no longer
// exports it); the upload-date label stays in admin/media. Never duplicate either formatter here.
const defaultFormatters: MediaMetadataFormatters = { formatByteSize, formatUploadDate };

/** The card's size text (owner, 2026-09-21) uses Jini's 1024-based KB/MB/GB, matching
 * the host's max-upload-bytes cap and chat's formatByteLimit rather than IEC KiB/MiB names. Whole B/KB
 * avoid unhelpful fractions; one decimal for MB/GB distinguishes similar clips near the 50 MB
 * upload cap. Intl.NumberFormat supplies locale separators, defaulting to en-US. */
export function useMediaCardMetadata(
  { item }: { item: MediaCardMetadataSource },
  { locale = "en-US", formatters = defaultFormatters, viewerTimeZone }: {
    locale?: string;
    formatters?: MediaMetadataFormatters;
    viewerTimeZone?: string | undefined;
  } = {},
) {
  const byteSize = item.byteSize == null ? null : formatters.formatByteSize({ bytes: item.byteSize }, { locale });
  const uploadDate = formatters.formatUploadDate?.({ createdAt: item.createdAt }, viewerTimeZone === undefined ? { locale } : { locale, viewerTimeZone }) ?? null;
  return legacyCardMetadata({ byteSize, uploadDate, createdAt: item.createdAt });
}

function legacyCardMetadata(
  { byteSize, uploadDate, createdAt }: { byteSize: string | null; uploadDate: string | null; createdAt: string },
  _options: Record<string, never> = {},
) {
  return {
    byteSize,
    uploadDate,
    uploadDateTime: uploadDate ? createdAt : undefined,
    metadataSeparator: byteSize && uploadDate ? " · " : "",
    hasMetadata: byteSize !== null || uploadDate !== null,
  };
}

import type {
  MediaAsset,
  MediaContentTabId,
  MediaTabId,
  MediaQuery,
  MediaMetadataPatch,
} from './models.js';
/** Falls back to "all" for an absent or unrecognized ?tab= value — don't trust a raw
 * query value: a stale link or a typo must not blank the panel. */
export function resolveActiveTab(
  { tabId }: { tabId?: string | null | undefined },
  _optional: Record<string, never> = {},
): MediaTabId {
  return tabId === 'images' || tabId === 'videos' || tabId === 'external-providers' ? tabId : 'all';
}
/** Prefix matching on image/ and video/ rather than an enumerated list of the sniffer's
 * current outputs: the server's sniffer allowlist can gain a format without this file
 * having to learn about it, and a prefix cannot mis-sort a type it has never seen.
 * application/octet-stream and null belong in All. SVG appears in Images, but its
 * byte-serving route must force download as a stored-XSS defusal. */
export function filterMediaByTab(
  { media, tab }: { media: readonly MediaAsset[]; tab: MediaContentTabId },
  _optional: Record<string, never> = {},
): readonly MediaAsset[] {
  if (tab === 'images') return media.filter((item) => item.contentType?.startsWith('image/'));
  if (tab === 'videos') return media.filter((item) => item.contentType?.startsWith('video/'));
  return media;
}
export function queryMedia(
  { media, query }: { media: readonly MediaAsset[]; query: MediaQuery },
  _optional: Record<string, never> = {},
): readonly MediaAsset[] {
  const search = query.search?.trim().toLocaleLowerCase() ?? '';
  const filtered = filterMediaByTab({ media, tab: query.filter ?? 'all' }).filter(
    (item) => (!query.status || item.status === query.status) &&
      (!search || `${item.title} ${item.alt}`.toLocaleLowerCase().includes(search)),
  );
  // Newest-first with id descending tiebreak, so same-tick batch uploads have deterministic order.
  // Alphabetical is case-insensitive A–Z, with id ascending on a title collision.
  return [...filtered].sort((a, b) =>
    query.orderBy === 'alphabetical'
      ? a.title.trim().toLocaleLowerCase().localeCompare(b.title.trim().toLocaleLowerCase()) ||
        a.id.localeCompare(b.id)
      : b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
/** item MUST be the same snapshot draft was seeded from, frozen for the caller's whole
 * edit session — never a live value that can advance independently of draft. If item
 * moves out from under a frozen draft, an untouched field whose server value changed
 * in the interim reads as "changed" and silently reverts the other operator's change. */
export function diffMediaMetadata(
  { item, draft }: { item: MediaAsset; draft: MediaMetadataPatch },
  _optional: Record<string, never> = {},
): MediaMetadataPatch {
  const patch: Record<string, unknown> = {};
  for (const key of ['title', 'slug', 'alt', 'caption', 'credit', 'width', 'height', 'cssClass', 'htmlAttributes'] as const)
    if (draft[key] !== undefined && draft[key] !== item[key]) patch[key] = draft[key];
  return patch as MediaMetadataPatch;
}
export function acceptsMedia(
  { item, accept }: { item: Pick<MediaAsset, 'contentType'>; accept: readonly string[] },
  _optional: Record<string, never> = {},
): boolean {
  if (accept.length === 0 || accept.includes('*/*')) return true;
  return (
    item.contentType !== null &&
    accept.some(
      (type) =>
        type === item.contentType ||
        (type.endsWith('/*') && item.contentType!.startsWith(type.slice(0, -1))),
    )
  );
}
export function safeMediaUrl(
  { url }: { url: string },
  _optional: Record<string, never> = {},
): string | undefined {
  // Fail closed on javascript:, data:, scheme-relative and backslash URLs. The host owns
  // same-origin authentication and attachment headers for HTML/SVG originals.
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:')
      return url;
  } catch {
    /* invalid URL */
  }
  return undefined;
}

/** A callable optional port, plus the legacy explicit-disable flag, is required. */
export function canReplaceMedia({ api }: { api: import('./ports.js').MediaApiPort }, _optional: Record<string, never> = {}) {
  return typeof api.replace === 'function' && api.replaceSupported !== false;
}
export function canRestoreMedia({ api }: { api: import('./ports.js').MediaApiPort }, _optional: Record<string, never> = {}) {
  return typeof api.restore === 'function' && api.restoreSupported !== false;
}
/** Prefer the transport's retryability decision. Older transports only expose HTTP
 * status in their message; network failures and temporary server failures recover too.
 * Authorization/validation failures must never produce an automatic request loop. */
export function isRetryableMediaError({ error }: { error: unknown }, _optional: Record<string, never> = {}) {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { retryable?: boolean; status?: number; statusCode?: number; message?: string };
  if (typeof failure.retryable === 'boolean') return failure.retryable;
  const status = failure.status ?? failure.statusCode ?? Number(failure.message?.match(/HTTP\s+(\d{3})/i)?.[1]);
  return status === 408 || status === 429 || (status >= 500 && status <= 599) || error instanceof TypeError;
}
/** Blank means native size; invalid values reach the server's positive-integer validator. */
export function parseOptionalPixelSize({ value }: { value: string }, _optional: Record<string, never> = {}): number | null {
  return value.trim() === '' ? null : Number(value);
}
/** 1024-based to agree with upload limits. Whole B/KB, one decimal MB/GB distinguishes
 * similarly sized clips; locale controls the decimal separator, never a hardcoded dot. */
export function formatByteSize({ bytes }: { bytes: number }, { locale = 'en-US' }: { locale?: string } = {}): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const mb = kb / 1024;
  return mb < 1024 ? `${decimal.format(mb)} MB` : `${decimal.format(mb / 1024)} GB`;
}
/** Full-library counts, independent of search/order/type selection; Providers has no count. */
export function countMediaTabs({ media }: { media: readonly MediaAsset[] }, _optional: Record<string, never> = {}) {
  return { all: media.length, images: filterMediaByTab({ media, tab: 'images' }).length,
    videos: filterMediaByTab({ media, tab: 'videos' }).length };
}
/** Readable slug markers survive title/hash changes. Escape attribute delimiters even
 * though real hosts validate slugs; a test or third-party adapter must not inject markup. */
export function mediaEmbedSnippet({ slug }: { slug?: string | undefined }, _optional: Record<string, never> = {}): string | null {
  if (!slug) return null;
  const config = JSON.stringify({ type: 'media', slug }).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div data-embed-config='${config}'></div>`;
}

/** Legacy row handles derive from stable IDs across the ENTIRE visible list. Per-card
 * slugification cannot resolve collisions: duplicate handles silently make page.click/fill
 * target the first DOM match. Search suffixes, because [x, x-2, X] can collide again.
 * This media-local shape mirrors the agent runtime's canonical list-handle contract without
 * adding a package dependency in a source-only change. */
export function mediaRowHandles({ media }: { media: readonly Pick<MediaAsset, 'id'>[] }, _optional: Record<string, never> = {}): readonly string[] {
  const used = new Set<string>();
  return media.map((item, index) => {
    const slug = item.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const preferred = `media-item-${slug || index + 1}`;
    let handle = preferred, suffix = 2;
    while (used.has(handle)) handle = `${preferred}-${suffix++}`;
    used.add(handle);
    return handle;
  });
}

/** A calendar date in UTC, so cards do not shift an upload to yesterday across host timezones. */
export function formatUploadDate({ createdAt }: { createdAt: string }, { locale = 'en-US' }: { locale?: string } = {}): string | null {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

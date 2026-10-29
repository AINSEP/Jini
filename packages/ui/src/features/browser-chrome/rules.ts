import type {
  AddressDisplayParts,
  BrowserHistoryEntry,
  BrowserNavigationEntry,
  BrowserNavigationState,
} from './types.js';
import { DEFAULT_HOME_NAVIGATION_ENTRY, EMPTY_URL, HISTORY_LIMIT } from './constants.js';
import { trimTrailingChars } from '../../utils/trim-chars.js';

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

export interface NormalizeBrowserAddressOptions {
  /**
   * Absolute-path prefixes (e.g. `['api', 'artifacts']`) that should resolve
   * against `appOrigin` instead of being treated as a local file path. A host
   * whose app serves its own routes under the same origin the browser tab is
   * embedded in supplies this; omit both to always fall back to `file://`.
   */
  appRoutePrefixes?: string[];
  /** Origin `appRoutePrefixes` matches resolve against — typically the host's `window.location.origin`. */
  appOrigin?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolves a `/`-rooted address: against `appOrigin` when it matches a configured app-route prefix, else as a local `file://` path. */
function resolveAbsolutePath(value: string, options: NormalizeBrowserAddressOptions): string {
  const { appRoutePrefixes = [], appOrigin } = options;
  if (appOrigin && appRoutePrefixes.length > 0) {
    const prefixPattern = new RegExp(`^/(${appRoutePrefixes.map(escapeRegExp).join('|')})(/|$)`);
    if (prefixPattern.test(value)) return new URL(value, appOrigin).toString();
  }
  return `file://${encodeURI(value)}`;
}

export function normalizeBrowserAddress(rawAddress: string, options: NormalizeBrowserAddressOptions = {}): string {
  const value = rawAddress.trim();
  if (!value || value === EMPTY_URL) return EMPTY_URL;
  if (/^(https?|file):\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`;
  if (value.startsWith('/')) return resolveAbsolutePath(value, options);
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function labelFromUrl(url: string, homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title): string {
  if (url === EMPTY_URL) return homeLabel;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export function formatAddressDisplayParts(
  url: string,
  title?: string,
  homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title,
): AddressDisplayParts {
  if (url === EMPTY_URL) return { url: '' };
  const cleanTitle = title?.trim();
  if (!cleanTitle) return { url };
  const fallback = labelFromUrl(url, homeLabel);
  if (cleanTitle === fallback || cleanTitle === url) return { url };
  return { url: trimTrailingChars(url, '/'), title: cleanTitle };
}

export function formatAddressDisplay(
  url: string,
  title?: string,
  homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title,
): string {
  const parts = formatAddressDisplayParts(url, title, homeLabel);
  if (!parts.url) return '';
  if (!parts.title) return parts.url;
  return `${parts.url} / ${parts.title}`;
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isHttpLikeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function faviconUrl(url: string): string | undefined {
  if (!isHttpLikeUrl(url)) return undefined;
  try {
    return new URL('/favicon.ico', new URL(url).origin).toString();
  } catch {
    return undefined;
  }
}

export function isHistoryUrl(url: string): boolean {
  return url !== EMPTY_URL && (isHttpLikeUrl(url) || /^file:\/\//i.test(url));
}

export function sameUrl(left: string, right: string): boolean {
  return trimTrailingChars(left, '/') === trimTrailingChars(right, '/');
}

function cleanIconUrl(url?: string): string | undefined {
  const value = url?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  return undefined;
}

// ---------------------------------------------------------------------------
// History entries
// ---------------------------------------------------------------------------

export function isHistoryEntry(value: unknown): value is BrowserHistoryEntry {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === 'string'
    && typeof record.title === 'string'
    && typeof record.lastVisitedAt === 'number'
    && typeof record.visitCount === 'number'
    && (record.iconUrl === undefined || typeof record.iconUrl === 'string')
  );
}

/** Namespace + scope key -> storage key. Namespace defaults to a generic Jini prefix (see `constants.ts`); scope key is host-supplied (e.g. a project or tab id). */
export function historyStorageKey(namespace: string, scopeKey: string): string {
  return `${namespace}:${scopeKey}`;
}

/** Parses a raw JSON storage payload into a sorted, deduped, limit-capped history list. Never throws — returns `[]` on any malformed input. */
export function parseHistoryPayload(raw: string, limit: number = HISTORY_LIMIT): BrowserHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isHistoryEntry)
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function serializeHistoryPayload(history: BrowserHistoryEntry[], limit: number = HISTORY_LIMIT): string {
  return JSON.stringify(history.slice(0, limit));
}

export interface MergeHistoryEntryMeta {
  title?: string;
  iconUrl?: string;
}

export interface MergeHistoryEntryOptions {
  /** Pass `false` to update an entry's metadata without counting a visit (e.g. a back/forward replay). Defaults to counting. */
  countVisit?: boolean;
}

/**
 * Merges a visited URL into a history list: updates the existing entry in
 * place (bumping it to the front) or inserts a new one, returning the SAME
 * array reference when nothing actually changed (so callers can skip a
 * re-render/re-save). `now` is injectable for deterministic tests.
 */
export function mergeHistoryEntry(
  history: BrowserHistoryEntry[],
  url: string,
  meta: MergeHistoryEntryMeta = {},
  options: MergeHistoryEntryOptions = {},
  now: number = Date.now(),
): BrowserHistoryEntry[] {
  if (!isHistoryUrl(url)) return history;
  const existing = history.find((entry) => sameUrl(entry.url, url));
  const entry = buildHistoryEntry({ url, meta, now, countVisit: options.countVisit !== false }, { existing });
  if (existing && sameHistoryEntryState(existing, entry)) return history;
  return [entry, ...history.filter((item) => !sameUrl(item.url, url))].slice(0, HISTORY_LIMIT);
}

interface BuildHistoryEntryInput {
  url: string;
  meta: MergeHistoryEntryMeta;
  now: number;
  countVisit: boolean;
}

/** Builds the merged entry for `url`: an update of `existing` when present, otherwise a fresh first-visit entry. */
function buildHistoryEntry(
  { url, meta, now, countVisit }: BuildHistoryEntryInput,
  { existing }: { existing?: BrowserHistoryEntry | undefined },
): BrowserHistoryEntry {
  const resolved = resolveHistoryMeta({ url, meta }, { existing });
  if (!existing) return { ...resolved, url, lastVisitedAt: now, visitCount: 1 };
  return {
    ...existing,
    ...resolved,
    lastVisitedAt: countVisit ? now : existing.lastVisitedAt,
    visitCount: existing.visitCount + (countVisit ? 1 : 0),
  };
}

/** Title and icon for a merged entry: the caller's meta wins, then the existing entry's, then values derived from `url`. */
function resolveHistoryMeta(
  { url, meta }: { url: string; meta: MergeHistoryEntryMeta },
  { existing }: { existing?: BrowserHistoryEntry | undefined },
): { iconUrl?: string; title: string } {
  // `isHistoryUrl` above already excludes `EMPTY_URL`, so `labelFromUrl`'s
  // home-label branch can never trigger here — no `homeLabel` option to pass.
  const title = meta.title?.trim() || existing?.title || labelFromUrl(url);
  const iconUrl = cleanIconUrl(meta.iconUrl) || existing?.iconUrl || faviconUrl(url);
  return iconUrl !== undefined ? { iconUrl, title } : { title };
}

function sameHistoryEntryState(left: BrowserHistoryEntry, right: BrowserHistoryEntry): boolean {
  return (
    left.title === right.title
    && left.iconUrl === right.iconUrl
    && left.lastVisitedAt === right.lastVisitedAt
    && left.visitCount === right.visitCount
  );
}

// ---------------------------------------------------------------------------
// Navigation stack
// ---------------------------------------------------------------------------

export function initialNavigationState(
  initialUrl?: string,
  initialTitle?: string,
  homeEntry: BrowserNavigationEntry = DEFAULT_HOME_NAVIGATION_ENTRY,
): BrowserNavigationState & { url: string; addressValue: string } {
  const trimmedUrl = initialUrl?.trim();
  const url = trimmedUrl && isHistoryUrl(trimmedUrl) ? trimmedUrl : EMPTY_URL;
  if (url === EMPTY_URL) {
    return {
      addressValue: '',
      navigationIndex: 0,
      navigationStack: [homeEntry],
      url,
    };
  }
  const title = initialTitle?.trim() || labelFromUrl(url, homeEntry.title);
  return {
    addressValue: url,
    navigationIndex: 0,
    navigationStack: [{ title, url }],
    url,
  };
}

export interface RecordNavigationOptions {
  replacePendingTarget?: boolean;
  pendingTarget?: string | null;
  homeLabel?: string;
}

/**
 * Records a navigation into the stack: updates the current entry in place if
 * the URL matches it (or an adjacent back/forward entry, or a pending-load
 * target), otherwise truncates any forward history and appends a new entry —
 * the same "linear stack with in-place back/forward matching" model a real
 * browser's history uses.
 */
export function recordNavigation(
  state: BrowserNavigationState,
  url: string,
  title?: string,
  options: RecordNavigationOptions = {},
): BrowserNavigationState {
  if (url !== EMPTY_URL && !isHistoryUrl(url)) return state;

  const { navigationStack: stack, navigationIndex: index } = state;
  const nextTitle = navigationTitle({ url }, { title, homeLabel: options.homeLabel });
  const rejoin = findRejoinTarget({ state, url }, options);
  if (rejoin) {
    const next = stack.slice();
    // `nextTitle` is only ever '' for EMPTY_URL with an explicit '' homeLabel;
    // keep the rejoined entry's own title rather than blanking it.
    next[rejoin.index] = { title: nextTitle || rejoin.entry.title, url };
    return { navigationStack: next, navigationIndex: rejoin.index };
  }

  const base = index >= 0 ? stack.slice(0, index + 1) : [];
  const nextStack = [...base, { title: nextTitle, url }].slice(-HISTORY_LIMIT);
  return { navigationStack: nextStack, navigationIndex: nextStack.length - 1 };
}

function navigationTitle({ url }: { url: string }, { title, homeLabel }: { title?: string | undefined; homeLabel?: string | undefined }): string {
  // Bug fix: this used to hardcode DEFAULT_HOME_NAVIGATION_ENTRY.title here,
  // ignoring a caller-supplied `options.homeLabel` — so a host configuring a
  // custom `homeEntry` (via useBrowserNavigationStack) would see the entry's
  // title silently revert to "New Tab" on any navigation back to EMPTY_URL,
  // even though `initialNavigationState`/`labelFromUrl` both honor the
  // custom label correctly. Falls back to the generic default only when no
  // homeLabel is supplied.
  if (url === EMPTY_URL) return homeLabel ?? DEFAULT_HOME_NAVIGATION_ENTRY.title;
  return title?.trim() || labelFromUrl(url, homeLabel);
}

interface RejoinTarget {
  index: number;
  entry: BrowserNavigationEntry;
}

/**
 * The stack entry `url` should update in place instead of appending: the
 * current entry (same url, or the pending-load target being replaced), else
 * the adjacent back entry, else the adjacent forward entry. An out-of-range
 * index reads as `undefined`, which never matches.
 */
function findRejoinTarget(
  { state, url }: { state: BrowserNavigationState; url: string },
  { replacePendingTarget, pendingTarget }: RecordNavigationOptions,
): RejoinTarget | undefined {
  const { navigationStack: stack, navigationIndex: index } = state;
  const current = stack[index];
  if (current && (sameUrl(current.url, url) || (replacePendingTarget && pendingTarget && sameUrl(current.url, pendingTarget)))) {
    return { index, entry: current };
  }
  return [index - 1, index + 1]
    .map((candidate) => ({ index: candidate, entry: stack[candidate] }))
    .find((target): target is RejoinTarget => target.entry !== undefined && sameUrl(target.entry.url, url));
}

export function updateCurrentNavigationTitle(state: BrowserNavigationState, title?: string): BrowserNavigationState {
  const trimmedTitle = title?.trim();
  const { navigationStack: stack, navigationIndex: index } = state;
  if (!trimmedTitle || index < 0) return state;
  const currentEntry = stack[index];
  if (!currentEntry || currentEntry.title === trimmedTitle) return state;
  const nextStack = stack.slice();
  nextStack[index] = { ...currentEntry, title: trimmedTitle };
  return { navigationStack: nextStack, navigationIndex: index };
}

export interface NavigationHistoryDeltaResult {
  state: BrowserNavigationState;
  entry: BrowserNavigationEntry;
}

/** Resolves a back (`delta: -1`) or forward (`delta: 1`) step. Returns `null` at either end of the stack. */
export function resolveNavigationHistoryDelta(
  state: BrowserNavigationState,
  delta: -1 | 1,
): NavigationHistoryDeltaResult | null {
  const targetIndex = state.navigationIndex + delta;
  const entry = state.navigationStack[targetIndex];
  if (!entry) return null;
  return {
    state: { navigationStack: state.navigationStack.slice(), navigationIndex: targetIndex },
    entry,
  };
}

export function canGoBack(state: BrowserNavigationState): boolean {
  return state.navigationIndex > 0;
}

export function canGoForward(state: BrowserNavigationState): boolean {
  return state.navigationIndex >= 0 && state.navigationIndex < state.navigationStack.length - 1;
}

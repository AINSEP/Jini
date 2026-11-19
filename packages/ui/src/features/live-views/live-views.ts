import { orFallback, orFallbackSync } from "@jini-ai/core/errors/idioms";

/** How long a hidden guest gets to answer the probe before it is kept as it is. */
export const RELEASE_PROBE_TIMEOUT_MS = 2000;
/** What a released guest leaves behind for its next mount: where it was, and how far scrolled. */
export interface ParkedView {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly innerY: number;
}

export interface LiveGuest {
  executeJavaScript(code: string): Promise<unknown>;
}
export interface ScrollGuest extends LiveGuest {
  addEventListener(type: 'did-finish-load', listener: () => void): void;
  removeEventListener(type: 'did-finish-load', listener: () => void): void;
}

export interface ReleaseAnswer {
  readonly release: boolean;
  /** `null` when there was nothing worth restoring (no guest, or an error page). */
  readonly parked: ParkedView | null;
}

const KEEP: ReleaseAnswer = { release: false, parked: null };

/**
 * The live tabs, most recently focused first: the focused tab leads, closed tabs drop out.
 * @complexity O(n²) over open tabs, which number in the tens.
 */
export function liveViewOrder({ order, focusedId, openIds }: {
  order: readonly string[];
  focusedId: string | null;
  openIds: readonly string[];
}, _options = {}): string[] {
  const open = new Set(openIds);
  const next = focusedId !== null && open.has(focusedId) ? [focusedId] : [];
  for (const id of order) if (open.has(id) && !next.includes(id)) next.push(id);
  return next;
}

/** Hidden live tabs to offer for release, least recently focused first, and how many must go. */
export function releaseCandidates({ order, focusedId, limit }: {
  order: readonly string[];
  focusedId: string | null;
  limit: number;
}, _options = {}): { candidates: string[]; excess: number } {
  const excess = order.length - limit;
  if (excess <= 0) return { candidates: [], excess: 0 };
  return { candidates: order.filter((id) => id !== focusedId).reverse(), excess };
}

function finite({ value }: { value: unknown }, _options = {}): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function webUrl({ value }: { value: unknown }, _options = {}): string | null {
  if (typeof value !== 'string') return null;
  return orFallbackSync({ work: () => {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  }, fallback: null, step: 'read parked view URL' });
}

/** Reads the guest's answer. Anything but an explicit `release: true` keeps the guest. */
export function parseReleaseProbe({ value }: { value: unknown }, _options = {}): ReleaseAnswer {
  if (typeof value !== 'object' || value === null) return KEEP;
  const answer = value as Record<string, unknown>;
  if (answer.release !== true) return KEEP;
  const url = webUrl({ value: answer.url });
  const parked = url === null ? null : { url, x: finite({ value: answer.x }), y: finite({ value: answer.y }), innerY: finite({ value: answer.innerY }) };
  return { release: true, parked };
}

/**
 * Asks one hidden guest whether it may go. A tab with no guest (its site stopped or failed) has
 * nothing to lose and is released at once.
 */
export async function probeRelease(
  { guest, script }: { guest: LiveGuest | null; script: string },
  { timeoutMs = RELEASE_PROBE_TIMEOUT_MS }: { timeoutMs?: number | undefined } = {},
): Promise<ReleaseAnswer> {
  if (guest === null) return { release: true, parked: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<unknown>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    // Electron throws synchronously from a guest that is not attached yet; the `catch` keeps it.
    return await orFallback({ work: async () => parseReleaseProbe({ value: await Promise.race([guest.executeJavaScript(script), timeout]) }), fallback: KEEP, step: 'probe guest release' });
  } finally {
    clearTimeout(timer);
  }
}

/** Probes candidates in order until `excess` of them agreed; a veto just moves on to the next. */
export async function releaseExcessViews({ candidates, excess, guestOf, script }: {
  candidates: readonly string[];
  excess: number;
  guestOf: (input: { id: string }) => LiveGuest | null;
  script: string;
}, { timeoutMs }: { timeoutMs?: number } = {}): Promise<{ id: string; parked: ParkedView | null }[]> {
  const released: { id: string; parked: ParkedView | null }[] = [];
  for (const id of candidates) {
    if (released.length >= excess) break;
    const answer = await probeRelease({ guest: guestOf({ id }), script }, { timeoutMs });
    if (answer.release) released.push({ id, parked: answer.parked });
  }
  return released;
}

/** The guest script that puts a restored page's scroll back. Numbers and a JSON-encoded selector, so nothing is injected.
 *  It retries for ~3 s because the guest renders its list after its own data arrives. */
export function scrollScript({ parked, innerScroller }: { parked: ParkedView; innerScroller: string }, _options = {}): string {
  const x = finite({ value: parked.x });
  const y = finite({ value: parked.y });
  const innerY = finite({ value: parked.innerY });
  return `(() => {
  let tries = 0;
  const step = () => {
    const inner = document.querySelector(${JSON.stringify(innerScroller)});
    window.scrollTo(${x}, ${y});
    if (inner) inner.scrollTop = ${innerY};
    const done = window.scrollY >= ${y} - 1 && (${innerY} === 0 || (inner !== null && inner.scrollTop >= ${innerY} - 1));
    if (!done && ++tries < 30) setTimeout(step, 100);
  };
  step();
})()`;
}

/**
 * Once a restored guest's first load finishes, puts its scroll back. Once per guest: a later reload
 * is the operator's own and starts wherever the page does.
 * @returns the teardown, or `undefined` when there is nothing to restore.
 */
export function restoreParkedScroll({ guest, parked, innerScroller }: {
  guest: ScrollGuest | null;
  parked: ParkedView | undefined;
  innerScroller: string;
}, { report }: { report?: (required: { error: unknown }) => void } = {}): (() => void) | undefined {
  if (guest === null || parked === undefined) return undefined;
  const target: ScrollGuest = guest;
  const script = scrollScript({ parked, innerScroller });
  const onLoad = () => {
    detach();
    orFallbackSync({ work: () => {
      void target.executeJavaScript(script).catch((error: unknown) => {
        // Closing the guest while restoring scroll is expected.
        if (!(error instanceof Error && /destroyed|not attached/i.test(error.message))) report?.({ error });
      });
    }, fallback: undefined, step: 'restore guest scroll' }); /* Guest gone. */
  };
  const detach = () => { orFallbackSync({ work: () => target.removeEventListener('did-finish-load', onLoad), fallback: undefined, step: 'detach guest scroll listener' }); /* Guest already gone. */ };
  return orFallbackSync({ work: () => { target.addEventListener('did-finish-load', onLoad); return detach; }, fallback: undefined, step: 'attach guest scroll listener' });
}

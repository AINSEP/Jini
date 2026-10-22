/** Native font/timer ports keep retries testable without module mocks or a real clock. */
export interface RemixIconFontSet {
  load(font: string, text?: string): Promise<FontFace[]>;
  check(font: string, text?: string): boolean;
  add(face: FontFace): void;
}

export interface FontRetryTimers {
  setTimeout(run: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface RecoveryInput {
  fonts: RemixIconFontSet;
  timers: FontRetryTimers;
  createFace(input: { attempt: number }): Pick<FontFace, 'load'>;
}

const FONT = '16px "remixicon"';
// Use a real private-use glyph: FontFaceSet.check alone also returns true for absent fonts.
const GLYPH = '\uea01';

/**
 * Probe the existing icon face once, then retry with fresh faces after bounded backoff.
 * A failed FontFace retains its rejected load promise, so loading that same face again cannot
 * recover. Adding the loaded replacement to the set makes existing icons repaint automatically.
 * Network/parse failures are consumed; exhaustion leaves the existing fallback in place.
 * @param input Explicit font set, fresh-face factory, and timer ports.
 * @param options Backoff delays in milliseconds, defaulting to 1s, 3s, 10s.
 * @returns Dispose function cancelling pending work and suppressing late font registration.
 * @complexity O(r) attempts and O(1) working space, where r is the supplied retry count.
 * @example startRemixIconFontRecovery({ fonts, timers, createFace });
 */
export function startRemixIconFontRecovery(
  { fonts, timers, createFace }: RecoveryInput,
  { retryDelays = [1000, 3000, 10000] }: { retryDelays?: readonly number[] } = {},
): () => void {
  let stopped = false;
  let attempt = 0;
  let pending: unknown;

  function scheduleRetry(): void {
    if (stopped) return;
    const delay = retryDelays[attempt];
    if (delay === undefined) { stopped = true; return; }
    pending = timers.setTimeout(() => {
      pending = undefined;
      void retry();
    }, delay);
  }

  async function retry(): Promise<void> {
    if (stopped) return;
    attempt++;
    try {
      const face = await createFace({ attempt }).load();
      if (stopped) return;
      fonts.add(face);
      stopped = true;
    } catch {
      scheduleRetry();
    }
  }

  async function probe(): Promise<void> {
    try {
      const faces = await fonts.load(FONT, GLYPH);
      if (stopped) return;
      if (faces.length > 0 && fonts.check(FONT, GLYPH)) { stopped = true; return; }
      scheduleRetry();
    } catch {
      scheduleRetry();
    }
  }

  void probe();
  return () => {
    stopped = true;
    if (pending !== undefined) timers.clearTimeout(pending);
  };
}

interface StylesheetRecoveryInput {
  stylesheet: HTMLStyleElement | HTMLLinkElement;
  fonts: RemixIconFontSet;
  timers: FontRetryTimers;
  baseUrl: string;
  createFontFace(input: { family: string; source: string; descriptors: FontFaceDescriptors }): FontFace;
}

/** The sheet's rules, or `undefined` when it has none yet or they are cross-origin inaccessible. */
function readStylesheetRules({ stylesheet }: { stylesheet: HTMLStyleElement | HTMLLinkElement }): CSSRuleList | undefined {
  try { return stylesheet.sheet?.cssRules; } catch { return undefined; }
}

function isRemixIconFaceRule(rule: CSSRule): rule is CSSFontFaceRule {
  if (rule.type !== 5) return false; // CSSRule.FONT_FACE_RULE (no global constructor in SSR/fakes).
  const family = (rule as CSSFontFaceRule).style.getPropertyValue('font-family').replace(/["']/g, '').trim();
  return family === 'remixicon';
}

/** The first RemixIcon face's url(...) source, or `undefined` when there is no such face or it has no url(). */
function findRemixIconFontSource({ rules }: { rules: CSSRuleList }): string | undefined {
  const face = Array.from(rules).find(isRemixIconFaceRule);
  // This package owns one url(...) WOFF2 source, not a general CSS font-source parser.
  return face?.style.getPropertyValue('src').match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
}

/** The source URL tagged with the attempt number; only http(s) URLs accept a query parameter. */
function retryFontUrl({ url, attempt }: { url: URL; attempt: number }): URL {
  // A distinct URL also bypasses the browser's cached failed font resource after a restart.
  const freshUrl = new URL(url.href);
  if (freshUrl.protocol === 'http:' || freshUrl.protocol === 'https:') {
    freshUrl.searchParams.set('jini-font-retry', String(attempt));
  }
  return freshUrl;
}

/**
 * Recover this package's single WOFF2 face using the owning stylesheet's resolved URL.
 * CSSOM, rather than a bundled-module URL, preserves host asset rewriting and linked CSS bases.
 * Cross-origin inaccessible sheets and overrides without our face are left to their owner.
 * @returns Retry disposer, or a no-op when this sheet does not expose the RemixIcon face.
 * @complexity O(n + r), where n is the owning sheet's rule count and r is the retry count.
 * @example startRemixIconStylesheetRecovery({ stylesheet, fonts, timers, baseUrl, createFontFace });
 */
export function startRemixIconStylesheetRecovery(
  { stylesheet, fonts, timers, baseUrl, createFontFace }: StylesheetRecoveryInput,
  options: { retryDelays?: readonly number[] } = {},
): () => void {
  const rules = readStylesheetRules({ stylesheet });
  const source = rules && findRemixIconFontSource({ rules });
  if (!source) return () => {};
  const url = new URL(source.trim(), stylesheet.sheet?.href ?? baseUrl);
  return startRemixIconFontRecovery({ fonts, timers, createFace({ attempt }) {
    const freshUrl = retryFontUrl({ url, attempt });
    return createFontFace({ family: 'remixicon', source: `url("${freshUrl.href}") format("woff2")`, descriptors: { display: 'swap' } });
  } }, options);
}

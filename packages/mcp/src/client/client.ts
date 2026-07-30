/**
 * @module @jini-ai/mcp/client/client
 * Product-neutral runtime primitives for a stdio MCP server: an idle-exit
 * controller that auto-closes an idle server process, a relative-reference
 * extractor that walks HTML/CSS/JS text to find sibling files to bundle, and a
 * textual-MIME classifier. Dependency-free (node stdlib only); imports no
 * sibling MCP subdirectory.
 */
// These are the generic, product-agnostic building blocks that back a stdio
// MCP server's lifecycle and its "pull an entry file plus everything it
// references" bundling. They hold no state beyond the idle controller's own
// timer and never touch the network or filesystem, so they unit-test against
// plain values.

interface McpIdleExitControllerOptions {
  idleMs: number;
  onIdle: () => void;
}

// SEC-RB-011: an unvalidated `idleMs` (negative, `NaN`, `Infinity`, or a
// non-integer) would either schedule an immediately/never-firing timer or
// hand `setTimeout` a value it silently coerces in surprising ways. Bound it
// to a sane, documented range instead: reject anything that isn't a finite
// positive integer (a caller bug, not something to silently paper over), and
// clamp anything absurdly large down to a one-day ceiling rather than
// scheduling an effectively-infinite timer.
const MIN_IDLE_MS = 1;
const MAX_IDLE_MS = 24 * 60 * 60 * 1000; // 24h

function normalizeIdleMs(idleMs: number): number {
  if (typeof idleMs !== 'number' || !Number.isFinite(idleMs) || !Number.isInteger(idleMs) || idleMs < MIN_IDLE_MS) {
    throw new RangeError(
      `createMcpIdleExitController: idleMs must be a finite positive integer (>= ${MIN_IDLE_MS}ms), got ${String(idleMs)}`,
    );
  }
  return Math.min(idleMs, MAX_IDLE_MS);
}

/**
 * Create an idle-exit controller that calls `onIdle` after `idleMs` of
 * inactivity. Activity is tracked via `noteActivity()` and `trackRequest()`;
 * in-flight requests defer the idle timer. Used to auto-close a long-running
 * stdio MCP server process after a period of no tool calls.
 * @param options Idle duration in ms (finite positive integer, clamped to a
 *   24h ceiling — throws `RangeError` otherwise) and the callback to invoke on idle.
 * @returns An object with `noteActivity`, `trackRequest`, and `dispose` methods.
 */
export function createMcpIdleExitController({
  idleMs,
  onIdle,
}: McpIdleExitControllerOptions) {
  const effectiveIdleMs = normalizeIdleMs(idleMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  let disposed = false;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (disposed) return;
    clear();
    timer = setTimeout(() => {
      // `dispose()` always clears the pending timer and `schedule()` bails when
      // already disposed, so this callback can only fire while live.
      timer = null;
      if (inFlight > 0) {
        schedule();
        return;
      }
      disposed = true;
      onIdle();
    }, effectiveIdleMs);
  };

  schedule();

  return {
    noteActivity() {
      schedule();
    },
    async trackRequest<T>(fn: () => T | Promise<T>): Promise<T> {
      if (disposed) {
        return fn();
      }
      inFlight += 1;
      // Deliberately does NOT call `schedule()` here (SEC-RB-011): a request
      // starting while the timer is already running doesn't need to reset
      // the deadline — the timer, if it fires mid-flight, already re-checks
      // `inFlight` and reschedules itself (above), and completion below
      // reschedules once the last in-flight request finishes. Rescheduling
      // on every concurrent request start instead caused needless
      // clearTimeout/setTimeout churn under load with no behavioral benefit.
      try {
        return await fn();
      } finally {
        inFlight -= 1;
        if (inFlight === 0) {
          schedule();
        }
      }
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

// Mimes whose body a stdio MCP server can surface as `text` content.
const TEXTUAL_MIME_PATTERNS = [
  /^text\//i,
  /^application\/json\b/i,
  /^application\/javascript\b/i,
  /^application\/typescript\b/i,
  /^application\/xml\b/i,
  /^application\/x-(yaml|toml|httpd-php|sh)\b/i,
  /\+json\b/i,
  /\+xml\b/i,
  /^image\/svg\+xml\b/i,
];

/**
 * True when `mime` names a textual content type whose body can be surfaced
 * as MCP `text` content (text/*, JSON, JS/TS, XML, YAML/TOML/PHP/sh, `+json`
 * / `+xml` suffixes, and SVG). Returns false for an absent/unknown mime.
 * @param mime The MIME type string to classify (undefined counts as non-textual).
 * @returns Whether the content should be treated as text.
 */
export function isTextualMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return TEXTUAL_MIME_PATTERNS.some((re) => re.test(mime));
}

// Patterns common to HTML and CSS (also fine to run on plain markdown).
const HTML_REF_PATTERNS = [
  /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
  /<img\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<source\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<video\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<audio\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi,
];

const CSS_REF_PATTERNS = [
  /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
  /@import\s+(?:url\()?\s*["']([^"')]+)["']/gi,
];

// JS/TS only - running these on prose creates false positives on words
// like "imported from 'X'".
const JS_REF_PATTERNS = [
  /\bimport\s+[^'"]*?['"]([^'"]+)['"]/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// `srcset` can list multiple comma-separated candidates.
const SRCSET_PATTERN = /\bsrcset=["']([^"']+)["']/gi;

function isJsLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /javascript|typescript/i.test(mime)) return true;
  return /\.(?:m?jsx?|tsx?|cjs)$/i.test(fromPath);
}

function isCssLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/css\b/i.test(mime)) return true;
  return /\.css$/i.test(fromPath);
}

function isHtmlLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/html\b/i.test(mime)) return true;
  return /\.html?$/i.test(fromPath);
}

/**
 * Extract all relative (non-absolute, non-CDN, non-data-URI) file references from
 * the text content of a file, normalized to root-relative paths.
 * Runs HTML, CSS, and/or JS pattern sets based on the file's MIME type and extension.
 * Skips `https?:`, `//`, `data:`, `mailto:`, `tel:`, and `#` prefixes; drops any
 * reference that would escape the root via `..` traversal.
 * @param text The textual content of the file.
 * @param fromPath The root-relative path of the file (used for relative-path resolution).
 * @param fromMime The MIME type of the file (used to select reference-extraction patterns).
 * @returns Deduplicated root-relative paths of all referenced files found.
 */
export function extractRelativeRefs(text: string, fromPath: string, fromMime: string): string[] {
  if (!text) return [];
  const refs = new Set<string>();
  const runPatterns: RegExp[] = [];
  if (isHtmlLike(fromMime, fromPath)) {
    runPatterns.push(...HTML_REF_PATTERNS, ...CSS_REF_PATTERNS);
  }
  if (isCssLike(fromMime, fromPath)) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }
  if (isJsLike(fromMime, fromPath)) {
    runPatterns.push(...JS_REF_PATTERNS);
  }
  // Fallback for unknown textual files: only the safest pattern,
  // url() in case it's a CSS-in-something we don't recognize.
  if (runPatterns.length === 0) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }

  const candidates: string[] = [];
  for (const re of runPatterns) {
    for (const m of text.matchAll(re)) {
      // The capture group is required in every pattern, so `m[1]` is always a
      // matched string here (the `!` only satisfies noUncheckedIndexedAccess).
      const ref = m[1]!.trim();
      if (ref) candidates.push(ref);
    }
  }
  // Pull every candidate URL out of any srcset attributes in HTML.
  if (isHtmlLike(fromMime, fromPath)) {
    for (const m of text.matchAll(SRCSET_PATTERN)) {
      const list = m[1]!;
      for (const part of list.split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      }
    }
  }

  for (const raw of candidates) {
    if (/^(?:https?:|\/\/|data:|mailto:|tel:|#)/i.test(raw)) continue;
    const dir = fromPath.includes('/')
      ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1)
      : '';
    const resolved = raw.startsWith('/') ? raw.slice(1) : dir + raw;
    const stripped = resolved.replace(/[?#].*$/, '');
    const segs = stripped.split('/').filter(Boolean);
    const out: string[] = [];
    let escaped = false;
    for (const s of segs) {
      if (s === '.') continue;
      if (s === '..') {
        if (out.length === 0) { escaped = true; break; }
        out.pop();
        continue;
      }
      out.push(s);
    }
    if (escaped || out.length === 0) continue;
    refs.add(out.join('/'));
  }
  return [...refs];
}

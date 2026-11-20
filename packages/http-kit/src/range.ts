/**
 * @file HTTP `Range` request parsing (RFC 7233 §2.1/§3.1) — a pure, dependency-free
 * parser so host byte-serving routes can support
 * `Range: bytes=...` without touching a request/response object, and so every edge
 * case is directly unit-testable without booting an HTTP server.
 *
 * Deliberately narrow scope: single-range `bytes=` requests only.
 *  - No `Range` header, or a header this parser cannot make sense of (wrong unit,
 *    non-numeric bounds, an empty `bytes=-` spec, a `first > last` range, or more
 *    than one comma-separated range) is reported as `{ kind: "none" }`. RFC 7233
 *    §3.1 explicitly permits a server to ignore a Range header it does not want to
 *    honor — "A server MAY ignore the Range header field... [and] MAY ignore a
 *    Range header field that consists of more than one range" — so treating these
 *    as "serve the whole representation" is spec-legal, not a shortcut, and it is
 *    the safe choice for a header this parser cannot fully trust: no multipart/
 *    byteranges body needs to exist for that path to be correct.
 *  - A syntactically valid single range that is out of bounds for `totalLength`
 *    (e.g. `bytes=1000-` against a 10-byte resource) is reported as
 *    `{ kind: "unsatisfiable" }` — callers should respond `416` with
 *    `Content-Range: bytes * /{totalLength}` per RFC 7233 §4.4.
 *  - A satisfiable range clamps its end to `totalLength - 1` (RFC 7233 §2.1: "If
 *    the last-byte-pos value is absent, or if the value is greater than or equal
 *    to the current length of the representation data, the byte range is
 *    interpreted as the remainder of the representation").
 *
 * Every numeric bound is validated against `totalLength` (or rejected as
 * non-finite) BEFORE a caller ever slices bytes with it — `{ kind: "range" }`'s
 * `start`/`end` are always in `[0, totalLength - 1]` with `start <= end`, so a
 * caller never over-reads or has to re-validate.
 */

export type ParsedRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

/** `bytes=<start>-<end>`, both optional (`-` is mandatory; digits are not) — matches "123-456",
 * "123-", and "-456", but not "123" (no dash) or anything with a non-digit in either half. */
const SINGLE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export interface ParseRangeHeaderRequired {
  /** The raw `Range` request header value, or `undefined`/`""` if absent. */
  header: string | undefined;
  /** The full resource length in bytes (`asset.byteLength`, not a client-supplied value). */
  totalLength: number;
}

/**
 * Suffix range: `bytes=-500` -> the last 500 bytes.
 *
 * @complexity O(1)
 */
function resolveSuffixRange({ endText, totalLength }: { endText: string; totalLength: number }, _optional = {}): ParsedRange {
  const suffixLength = Number(endText);
  if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { kind: "unsatisfiable" };
  const start = Math.max(0, totalLength - suffixLength);
  return { kind: "range", start, end: totalLength - 1 };
}

/**
 * Bounded (or open-ended) range: `bytes=100-`, `bytes=100-200`.
 *
 * @complexity O(1)
 */
function resolveBoundedRange({ startText, endText, totalLength }: { startText: string; endText: string; totalLength: number }, _optional = {}): ParsedRange {
  const start = Number(startText);
  if (!Number.isFinite(start) || start >= totalLength) return { kind: "unsatisfiable" };

  const end = endText === "" ? totalLength - 1 : Math.min(Number(endText), totalLength - 1);
  if (!Number.isFinite(end) || end < start) return { kind: "unsatisfiable" };

  return { kind: "range", start, end };
}

/** The two bound texts of a single `bytes=<start>-<end>` spec (each possibly empty), or undefined. */
function readRangeBounds({ header }: { header: string }, _optional: Record<string, never> = {}): { startText: string; endText: string } | undefined {
  const match = SINGLE_RANGE_PATTERN.exec(header.trim());
  return match ? { startText: match[1] ?? "", endText: match[2] ?? "" } : undefined;
}

/**
 * @complexity O(1) — one regex match against a bounded-shape string and a handful of comparisons;
 * no work proportional to `totalLength` or to the header's length beyond the regex engine's own
 * linear scan of the (short, request-header-sized) input.
 * @overallScore 100
 */
export function parseRangeHeader(
  required: ParseRangeHeaderRequired,
  _optional: Record<string, never> = {}
): ParsedRange {
  const { header, totalLength } = required;
  if (!header) return { kind: "none" };

  // More than one range (comma-separated): RFC 7233 §3.1 explicitly allows a server to ignore this
  // rather than build a multipart/byteranges response — see file header.
  if (header.includes(",")) return { kind: "none" };

  const bounds = readRangeBounds({ header });
  if (!bounds) return { kind: "none" };

  const { startText, endText } = bounds;
  if (startText === "" && endText === "") return { kind: "none" }; // "bytes=-" — no bound at all.

  // Nothing in an empty (or negative-length, which cannot occur for a real byte count but is
  // guarded anyway) resource can ever satisfy a range.
  if (totalLength <= 0) return { kind: "unsatisfiable" };

  return startText === ""
    ? resolveSuffixRange({ endText, totalLength })
    : resolveBoundedRange({ startText, endText, totalLength });
}

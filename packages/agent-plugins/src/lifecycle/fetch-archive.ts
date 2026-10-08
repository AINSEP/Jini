/**
 * @file The network front half of the Agent Plugin install pipeline: URL -> verified bytes.
 *
 * `install.ts` deliberately takes `archive: Uint8Array` and never a URL — it is a pure
 * verify/extract/publish step with no network surface at all. This module is the one place that
 * talks to the network, and it hands `install.ts` exactly what it already accepts. The split is
 * kept on purpose: every hostile-archive guard in `install.ts` (`DIGEST_MISMATCH`, zip-slip,
 * decompression caps) stays reachable from a plain in-memory buffer in tests, with no fetch mock.
 *
 * What this module does NOT do:
 * - It does not decide whether a digest is trustworthy. `expectedSha256` is verified by
 *   `install.ts`, not here; {@link fetchAgentPluginArchive} only reports the digest of what
 *   actually arrived so a caller can pin it.
 * - It does not follow a redirect chain by hand. `fetch` handles redirects; the scheme guard below
 *   re-runs on the FINAL response URL so an `https://` start cannot be redirected onto a
 *   non-network scheme.
 * - It does not trust `Content-Length`. That header is attacker-controlled for a hostile host; the
 *   cap below is enforced against bytes actually read, and `Content-Length` is used only as an
 *   early reject so an obviously-oversized download is not started at all.
 */
import type { AgentPluginOutboundGuardPort, AgentPluginFetchPort } from "./ports.js";

import { createHash } from "node:crypto";
import { STATUS_CODES } from "node:http";

/**
 * Mirrors `install.ts`'s own `LIMITS.maxArchiveBytes` — a download this module would accept but
 * `installAgentPlugin` would then reject with `ARCHIVE_TOO_LARGE` is wasted bandwidth, so the cap
 * is enforced at the earliest point it can be. Kept as its own constant rather than imported so
 * this module has no dependency on `install.ts`; the pairing is asserted by a unit test instead.
 */
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

/**
 * `http:` is permitted alongside `https:` because a self-hosted the host's first registry is realistically
 * a machine on its own network (and because the local end-to-end proof of this pipeline serves over
 * loopback). Transport confidentiality is NOT what protects an install here — `expectedSha256` is.
 * Every other scheme is refused: `file:`/`data:` would turn a "download a plugin" call into an
 * arbitrary local-file read reachable from whatever supplies the URL.
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

export type AgentPluginFetchErrorCode =

  | "UNSUPPORTED_URL"

  | "REQUEST_FAILED"

  | "HTTP_ERROR"

  | "ARCHIVE_TOO_LARGE"

  | "EMPTY_BODY";

/**
 * The URL did not parse, or its scheme is not in {@link ALLOWED_PROTOCOLS}.
 *
 * The request never produced a response — DNS failure, connection refused, TLS failure, abort.
 *
 * A response arrived with a non-2xx status.
 *
 * The response body exceeded {@link MAX_ARCHIVE_BYTES}, by header or by bytes actually read.
 *
 * A 2xx response with no body at all — never a valid archive, and a clearer error than letting
 * the zip reader fail on zero bytes.
 */
export class AgentPluginFetchError extends Error {
  readonly code: AgentPluginFetchErrorCode;

  constructor({ code, message }: { readonly code: AgentPluginFetchErrorCode; readonly message: string }, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentPluginFetchError";
    this.code = code;
  }
}

export interface FetchAgentPluginArchiveRequired {

  readonly url: string;
  readonly fetch: AgentPluginFetchPort;
  readonly outboundGuard: AgentPluginOutboundGuardPort;
}

/**
 * Absolute `https:` or `http:` URL of a plugin `.zip`.
 */
export interface FetchAgentPluginArchiveOptional {

  readonly maxBytes?: (number) | undefined;

  readonly signal?: (AbortSignal) | undefined;
}

/**
 * Injectable for tests and for a caller that needs its own agent/proxy. Defaults to global `fetch`.
 *
 * Lowered by a caller that wants a tighter cap than the module default. Never raised above
 * {@link MAX_ARCHIVE_BYTES} — a larger value is clamped, because `install.ts` would reject it anyway.
 *
 * Forwarded to `fetch`, so a caller can time out or cancel a slow download.
 */
export interface FetchedAgentPluginArchive {
  readonly archive: Uint8Array;

  readonly sha256: string;

  readonly resolvedUrl: string;
}

/**
 * Lowercase hex SHA-256 of `archive` as received. Pass to `installAgentPlugin` as
 * `expectedSha256` only if the caller has independently decided to trust these bytes — this value
 * is computed from the download itself and therefore proves nothing about origin on its own.
 *
 * The FINAL URL after redirects, which may differ from the requested one.
 *
 * Downloads one Agent Plugin archive into memory, bounded and digested.
 *
 * @throws {AgentPluginFetchError} For every expected failure. A caller distinguishes them by `code`.
 * @complexity O(b) in bytes downloaded, bounded by `maxBytes`.
 */
export async function fetchAgentPluginArchive(
  required: FetchAgentPluginArchiveRequired,
  optional: FetchAgentPluginArchiveOptional = {},
): Promise<FetchedAgentPluginArchive> {
  /**
   * Re-checked against the FINAL url: `redirect: "follow"` means the scheme validated above is not
   * necessarily the scheme the bytes came from.
   */
  const maxBytes = Math.min(optional.maxBytes ?? MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive integer");

  assertAllowedUrl(required.url, "requested");
  const diagnosticUrl = redactArchiveUrl({ value: required.url });

  let response: Response;
  let finalRequestedUrl = required.url;
  try {
    const downloaded = await fetchWithGuard(required, optional);
    response = downloaded.response;
    finalRequestedUrl = downloaded.resolvedUrl;
  } catch {
    // Dependency messages and nested causes can contain signed redirect URLs or bare tokens.
    // Keep neither: sanitizing only the requested URL still exposes secrets through error.cause.
    throw new AgentPluginFetchError({ code: "REQUEST_FAILED", message: `could not fetch '${diagnosticUrl}': archive request failed` }, {
      cause: new Error("archive request failed"),
    });
  }

  // A server-controlled reason phrase can reflect secrets; use the standard status label.
  if (!response.ok) {
    throw new AgentPluginFetchError({ code: "HTTP_ERROR", message: `'${diagnosticUrl}' returned HTTP ${response.status} ${STATUS_CODES[response.status] ?? ''}`.trimEnd() });
  }

  const resolvedUrl = response.url || finalRequestedUrl;
  assertAllowedUrl(resolvedUrl, "redirected-to");

  assertDeclaredSizeWithinCap(response, maxBytes, diagnosticUrl);

  let archive: Uint8Array;
  try {
    archive = await readBodyWithinCap(response, maxBytes, diagnosticUrl);
  } catch (error) {
    // Preserve our bounded-download error; stream failures must not escape as raw transport text.
    if (error instanceof AgentPluginFetchError && error.code === "ARCHIVE_TOO_LARGE") {
      throw new AgentPluginFetchError({ code: "ARCHIVE_TOO_LARGE", message: `'${diagnosticUrl}' body exceeded the ${maxBytes}-byte cap` });
    }
    throw new AgentPluginFetchError({ code: "REQUEST_FAILED", message: `could not read '${diagnosticUrl}': archive response body failed` }, {
      cause: new Error("archive response body failed"),
    });
  }
  if (archive.byteLength === 0) {
    throw new AgentPluginFetchError({ code: "EMPTY_BODY", message: `'${diagnosticUrl}' returned an empty body` });
  }

  return {
    archive,
    sha256: createHash("sha256").update(archive).digest("hex"),
    resolvedUrl,
  };
}

/**
 * The module's own cap, exported so a caller (or a test pinning it against `install.ts`'s
 * `LIMITS.maxArchiveBytes`) can read it without duplicating the number.
 */
export function maxAgentPluginArchiveBytes(_required: Record<string, never>): number {
  return MAX_ARCHIVE_BYTES;
}

function assertAllowedUrl(value: string, position: "requested" | "redirected-to"): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AgentPluginFetchError({ code: "UNSUPPORTED_URL", message: `'${redactArchiveUrl({ value })}' is not an absolute URL` });
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AgentPluginFetchError({ code: "UNSUPPORTED_URL", message: `${position} URL '${redactArchiveUrl({ value })}' uses unsupported scheme '${parsed.protocol}' — only https: and http: are allowed` });
  }
}

/**
 * Early reject on a self-declared oversized body. Advisory only — {@link readBodyWithinCap} is the
 * enforcement, because a hostile host can under-report or omit this header entirely.
 */
function assertDeclaredSizeWithinCap(response: Response, maxBytes: number, url: string): void {
  const header = response.headers.get("content-length");
  if (header === null) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AgentPluginFetchError({ code: "ARCHIVE_TOO_LARGE", message: `'${url}' declares ${declared} bytes, over the ${maxBytes}-byte cap` });
  }
}

/**
 * Reads the body chunk by chunk, aborting the moment the running total would exceed the cap — so a
 * hostile endpoint streaming an unbounded body cannot drive this process out of memory. Buffering
 * the whole response first (`await response.arrayBuffer()`) would defeat the cap entirely.
 */
async function readBodyWithinCap(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  /**
   * Releases the connection on the throw path too; without it an aborted oversized download
   * leaves the socket held until GC.
   */
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AgentPluginFetchError({ code: "ARCHIVE_TOO_LARGE", message: `'${url}' body exceeded the ${maxBytes}-byte cap` });
      }
      chunks.push(value);
    }
  } finally {

    await reader.cancel().catch(() => {});
  }

  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

/**
 * Diagnostics retain only the URL's public location; requests and resolvedUrl retain the original.
 * Unparseable input is never echoed because its credential boundary cannot be identified safely.
 * @complexity O(n) time and space in the URL length.
 */
function redactArchiveUrl({ value }: { readonly value: string }): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "[invalid URL]";
  }
  if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) return value;
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

/** Redirects are followed only after guarding each destination; never contact an unguarded hop. */
async function fetchWithGuard(required: FetchAgentPluginArchiveRequired, optional: FetchAgentPluginArchiveOptional): Promise<{ readonly response: Response; readonly resolvedUrl: string }> {
  let url = required.url;
  for (let hop = 0; hop <= 10; hop++) {
    assertAllowedUrl(url, 'requested');
    await required.outboundGuard.assertAllowed({ url });
    const response = await required.fetch({ url }, {
      redirect: 'manual', ...(optional.signal ? { signal: optional.signal } : {}),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, resolvedUrl: url };
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Archive redirect has no Location header');
    url = new URL(location, url).href;
  }
  throw new Error('Archive redirect limit exceeded');
}

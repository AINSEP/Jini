import type { AgentPluginOutboundGuardPort, AgentPluginFetchPort } from "./ports.js";

import { createHash } from "node:crypto";
import { STATUS_CODES } from "node:http";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

export type AgentPluginFetchErrorCode =

  | "UNSUPPORTED_URL"

  | "REQUEST_FAILED"

  | "HTTP_ERROR"

  | "ARCHIVE_TOO_LARGE"

  | "EMPTY_BODY";

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

export interface FetchAgentPluginArchiveOptional {

  readonly maxBytes?: (number) | undefined;

  readonly signal?: (AbortSignal) | undefined;
}

export interface FetchedAgentPluginArchive {
  readonly archive: Uint8Array;

  readonly sha256: string;

  readonly resolvedUrl: string;
}

export async function fetchAgentPluginArchive(
  required: FetchAgentPluginArchiveRequired,
  optional: FetchAgentPluginArchiveOptional = {},
): Promise<FetchedAgentPluginArchive> {
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

function assertDeclaredSizeWithinCap(response: Response, maxBytes: number, url: string): void {
  const header = response.headers.get("content-length");
  if (header === null) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AgentPluginFetchError({ code: "ARCHIVE_TOO_LARGE", message: `'${url}' declares ${declared} bytes, over the ${maxBytes}-byte cap` });
  }
}

async function readBodyWithinCap(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

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

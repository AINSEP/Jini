import { exportUrlLocations } from "../html-url-locations.js";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";

export interface ExportMediaUrlDeps<R extends { status: string; kind?: string | undefined; source: { sha256: string } }> {
  workspaceId: string;
  originRegistry: Pick<OriginRegistryPort, "canonicalOrigin">;
  findMedia(required: { workspaceId: string; idOrSlug: string }, optional?: Record<string, never>): Promise<R | null>;
  resolveContentTypes(required: { media: readonly R[] }, optional?: Record<string, never>): Promise<ReadonlyMap<string, string>>;
  mediaPublicPath(required: { key: string; sha256: string; variant: { kind: "original"; contentType: string } }, optional?: Record<string, never>): string;
}

// Match complete local media paths in HTML, CSS, XML and JSON, retaining query/fragment tails.
// Check absolute URLs against the configured origin: another site's /m/ namespace is not ours.
const ORIGINAL_URL = /(?<![\w/.:%-])((?:https?:)?\/\/[^/\s"'<>\\()]+)?\/m\/([^/\s"'<>\\()?#]+)\/original(?![^\s"'<>\\()?#,;])(?:\?[^\s"'<>\\()#]*)?/g;

/** Same origin as the configured site; an unparsable URL is never ours. */
function sameOrigin({ url, origin }: { url: string; origin: string }): boolean {
  try { return new URL(url, origin).origin === origin; } catch { return false; }
}

/** The configured origin as `URL.origin` spells it: a verified custom port is part of the origin
 *  (a default port is dropped), and an unparsable configuration is never ours. */
function configuredOrigin({ scheme, host, port }: { scheme: string; host: string; port?: number | undefined }): string | null {
  try { return new URL(`${scheme}://${host}${port === undefined ? "" : `:${port}`}`).origin; } catch { return null; }
}

/** Local paths need no origin lookup; absolute references must belong to the configured site.
 * With no verified origin, absolute references stay as written: a link must never fail the export. */
async function localOriginalPaths<R extends { status: string; kind?: string | undefined; source: { sha256: string } }>({ body, deps, locations }: { body: string; deps: ExportMediaUrlDeps<R>; locations: readonly { start: number; end: number }[] }, _optional: Record<string, never> = {}): Promise<Map<string, { prefix: string; key: string }>> {
  const matches = locations.flatMap(({ start, end }) => [...body.slice(start, end).matchAll(ORIGINAL_URL)]);
  const paths = new Map<string, { prefix: string; key: string }>();
  let origin: string | null | undefined;
  for (const match of matches) {
    if (match[1]) {
      origin ??= await deps.originRegistry.canonicalOrigin({ workspaceId: deps.workspaceId })
        .then(configuredOrigin, () => null);
      if (!origin || !sameOrigin({ url: match[0], origin })) continue;
    }
    let key: string | undefined;
    const raw = match[2];
    if (raw !== undefined) {
      try { key = decodeURIComponent(raw); } catch { /* Malformed escapes are not media keys. */ }
    }
    // Absolute URLs stay absolute (sitemaps and og:image require them); only the path is upgraded.
    if (key !== undefined) paths.set(match[0], { prefix: match[1] ?? "", key });
  }
  return paths;
}

/** Upgrade stored URLs using the same lookup and read-path type backfill as the media library.
 * O(text length + URL positions log URL positions + distinct media keys) work, one batched type lookup; legacy bytes read only
 * when their type was never recorded. Missing/private documents retain their existing URLs.
 */
export async function rewriteMediaOriginalUrls<R extends { status: string; kind?: string | undefined; source: { sha256: string } }>(
  { body, deps }: { body: string; deps: ExportMediaUrlDeps<R> }, { contentType = "text/html" }: { contentType?: string } = {},
): Promise<string> {
  // Parsed once: the same URL positions are scanned for keys and then rewritten.
  const locations = exportUrlLocations({ body, contentType });
  const paths = await localOriginalPaths({ body, deps, locations });
  if (paths.size === 0) return body;
  const records = await exportableMediaRecords({ paths, deps });
  const contentTypes = await deps.resolveContentTypes({ media: [...records.values()] });
  const replacements = new Map<string, string>();
  for (const [url, record] of records) {
    const type = contentTypes.get(record.source.sha256);
    const path = paths.get(url);
    if (path === undefined) throw new Error("Export media record has no matching URL path");
    const { prefix, key } = path;
    const query = new URL(url, "https://export.invalid").searchParams;
    query.delete("v");
    if (type) replacements.set(url, prefix + deps.mediaPublicPath({ key, sha256: record.source.sha256, variant: { kind: "original", contentType: type } }) + (query.size ? `&${query}` : ""));
  }
  const output: string[] = [];
  let offset = 0;
  for (const { start, end } of locations) {
    const value = body.slice(start, end).replace(ORIGINAL_URL, url => replacements.get(url) ?? url);
    output.push(body.slice(offset, start), value);
    offset = end;
  }
  output.push(body.slice(offset));
  return output.join('');
}

/** Missing, inactive and document records keep their original URL; lookups remain sequential. */
async function exportableMediaRecords<R extends { status: string; kind?: string | undefined; source: { sha256: string } }>({ paths, deps }: { paths: ReadonlyMap<string, { key: string }>; deps: ExportMediaUrlDeps<R> }, _optional: Record<string, never> = {}) {
  const records = new Map<string, R>();
  for (const [url, { key }] of paths) {
    const record = await deps.findMedia({ workspaceId: deps.workspaceId, idOrSlug: key });
    if (record && record.status === "active" && record.kind !== "document") records.set(url, record);
  }
  return records;
}

/** Rewrite textual responses before the existing exporter writes AND crawls them. Binary responses
 * stay streaming and untouched. Response headers remain authoritative except for the byte length,
 * which must be recalculated after a text rewrite. No extra HTTP requests or renderer are used.
 */
export async function rewriteExportMediaResponse<R extends { status: string; kind?: string | undefined; source: { sha256: string } }>(
  { response, deps }: { response: Response; deps: ExportMediaUrlDeps<R> }, _optional: Record<string, never> = {},
): Promise<Response> {
  if (response.body === null) return response;
  if (!/^(?:text\/(?:html|css)|application\/(?:[\w.+-]*\+)?(?:json|xml))\b/i.test(response.headers.get("content-type") ?? "")) return response;
  const body = await rewriteMediaOriginalUrls({ body: await response.text(), deps }, { contentType: response.headers.get("content-type") ?? "" });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

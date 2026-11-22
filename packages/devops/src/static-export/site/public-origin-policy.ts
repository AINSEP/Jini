import {
  resolveConfiguredOrigin,
  type OriginRegistryPort,
} from "@jini-ai/core/contracts/server/verified-origin";
import { orFallback } from "@jini-ai/core/errors/idioms";

/** Same loopback spellings URL normalizes from IPv4/IPv6 literals, including mapped IPv4. */
function isRenderHost({ hostname }: { hostname: string }, _options = {}): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return /^(?:localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[(?:::1|::|::ffff:7f[\da-f]{2}:[\da-f]+)\])$/.test(host);
}

/** Only the registry's public evidence counts; a dev seed must never become export identity.
 * Reuse the configured-origin owner's validation, including loopback and credential refusal.
 * Registry absence degrades the export to a copy without public identity, as it does live SEO.
 * @complexity One registry read; O(origin length) validation, no network access.
 */
export async function exportPublicOrigin({ registry, workspaceId }: { registry: OriginRegistryPort; workspaceId: string }, _options = {}): Promise<string | undefined> {
  const evidence = await orFallback({ work: () => registry.canonicalOrigin({ workspaceId }), fallback: undefined, step: "Read configured export origin" });
  if (evidence === undefined) return undefined;
  if (evidence.source !== "workspace-setting") return undefined;
  const raw = `${evidence.scheme}://${evidence.host}${evidence.port === undefined ? "" : `:${evidence.port}`}`;
  const accepted = resolveConfiguredOrigin({ env: { origin: raw }, envVarName: "origin", clock: { nowIso: () => evidence.verifiedAt }, warn: () => {} });
  if (!accepted) return undefined;
  const parsed = new URL(raw);
  return isRenderHost({ hostname: parsed.hostname }) ? undefined : parsed.origin;
}

/** Replace render authority everywhere, including JSON-LD and plain-text discovery files.
 * Root-relative paths and external URLs retain their exact bytes. A JSON escaped slash retains
 * its encoding. The ephemeral crawl origin and persisted dev origins need the same treatment.
 * @complexity O(body bytes), no requests or path/layout changes.
 */
export function rewriteRenderOrigins({ body, renderOrigin, publicOrigin, sourceOrigin }: { body: string; renderOrigin: string; publicOrigin?: string | undefined; sourceOrigin?: string | undefined }, _options = {}): string {
  return body.replace(/(?:\bhttps?:|(?<![:\w]))(?:\/\/|\\\/\\\/)(?:[^\s/"'<>\\()?#@]+@)?(?:\[[\da-f:.]+\]|[\w.-]+)(?::\d+)?/gi, (raw, offset: number) => {
    let parsed: URL;
    try { parsed = new URL(raw.replaceAll("\\/", "/"), renderOrigin); } catch { return raw; }
    if (parsed.origin !== renderOrigin && parsed.origin !== sourceOrigin && !isRenderHost({ hostname: parsed.hostname })) return raw;
    const tail = body.slice(offset + raw.length, offset + raw.length + 2);
    const replacement = publicOrigin ?? (/^(?:\/|\\\/)/.test(tail) ? "" : "/");
    return raw.includes("\\/") ? replacement.replaceAll("/", "\\/") : replacement;
  });
}

/** Transform every textual response before the owner crawls/writes it; binary media streams through.
 * The copied response has no stale length/encoding headers after decoding and editing its body.
 * @complexity O(response text bytes), one buffered response and no additional fetch.
 */
export async function rewriteExportOriginResponse({ response, url, publicOrigin, sourceOrigin }: { response: Response; url: string; publicOrigin?: string | undefined; sourceOrigin?: string | undefined }, _options = {}): Promise<Response> {
  const headers = new Headers(response.headers);
  const location = headers.get("location");
  const renderOrigin = new URL(url).origin;
  if (location) headers.set("location", rewriteRenderOrigins({ body: location, renderOrigin, publicOrigin, sourceOrigin }));
  if (response.body === null) return new Response(null, { status: response.status, statusText: response.statusText, headers });
  if (!/^(?:text\/|image\/svg\+xml\b|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript)\b)/i.test(headers.get("content-type") ?? "")) return response;
  let body = rewriteRenderOrigins({ body: await response.text(), renderOrigin, publicOrigin, sourceOrigin });
  if (!publicOrigin && new URL(url).pathname === "/robots.txt") body = body.replace(/^[\t ]*Sitemap:[^\r\n]*(?:\r?\n|$)/gim, "");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

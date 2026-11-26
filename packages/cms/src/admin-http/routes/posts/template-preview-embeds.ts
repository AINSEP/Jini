import { defineJsonRoute, ok, type JsonRouteAuthorize, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { parse, type DefaultTreeAdapterMap } from "parse5";

/**
 * @file `POST /api/admin/v1/workspaces/:workspaceId/posts/:postId/template-preview/embeds` — read the
 * iframe sources of a post's rendered template preview, for the host to turn into links.
 *
 * Inspection works on the HTML the host's already-authorized preview renderer produced, never on the
 * preview document itself: that document is intentionally unreadable to the admin frame (sandboxed),
 * and this route must not trade the sandbox for easier inspection. The route parses the markup as
 * inert data — it never navigates, runs a script or fetches a source — and hands the host's
 * projector only the ordered `src` strings. Which sources earn a link is the host's policy.
 */

/** What the host's renderer needs to render the pending post exactly as the HTML preview would. */
export interface PreviewEmbedsInput {
  postId: string;
  rawTemplateChoice: unknown;
  body: unknown;
}

/** The principal fields this route reads: only its presence. */
export interface PreviewEmbedsPrincipal { id: string }

/** The host's collaborators, injected at mount (not at factory creation). */
export interface PreviewEmbedsRouteDeps<TOutput> {
  renderPreview(required: PreviewEmbedsInput, optional?: { signal?: AbortSignal | undefined }): Promise<{ html: string }>;
  projectEmbeds(required: { iframeSources: readonly string[] }, optional?: Record<string, never>): TOutput;
}

/** The embeds spec, with its no-store header on every answer (as the widget preview route sets it). */
export type PreviewEmbedsRouteSpec<TOutput> = JsonRouteSpec<PreviewEmbedsInput, TOutput, PreviewEmbedsRouteDeps<TOutput>, PreviewEmbedsPrincipal> & { responseHeaders: Readonly<Record<string, string>> };

/** Set on every answer: an embed list is per-operator draft output. */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

type ChildNode = DefaultTreeAdapterMap["childNode"];

/** The child list of an element or template host, `[]` for leaves (comments, text). A `template`'s
 * own children are empty — its markup lives in `.content`, which is deliberately not read. */
function childrenOf({ node }: { node: ChildNode }, _optional: Record<string, never> = {}): readonly ChildNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

/** The `src` of an HTML-namespace iframe element, `undefined` for anything else or a missing attribute. */
function iframeSourceOf({ node }: { node: ChildNode }, _optional: Record<string, never> = {}): string | undefined {
  if (node.nodeName !== "iframe" || !("namespaceURI" in node) || node.namespaceURI !== HTML_NAMESPACE) return undefined;
  return node.attrs.find(attr => attr.name === "src")?.value;
}

/** Every iframe `src`, in document order. Comments and text (script bodies included) are never
 * elements, `srcdoc` is never read, and `template.content` is a separate fragment that is not
 * descended into, so inert markup cannot count as an embed.
 * @complexity O(n) in the node count. */
function collectIframeSources({ html }: { html: string }, _optional: Record<string, never> = {}): string[] {
  const sources: string[] = [];
  const visit = ({ children }: { children: readonly ChildNode[] }): void => {
    for (const child of children) {
      const source = iframeSourceOf({ node: child });
      if (source !== undefined) sources.push(source);
      visit({ children: childrenOf({ node: child }) });
    }
  };
  visit({ children: parse(html).childNodes });
  return sources;
}

/** `content.read` with no entity type or id. A mount without an authorizer is a wiring bug. */
async function authorizeRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("template preview embeds route has no authorizer");
  await authorize({ permission: "content.read" });
}

/** The embeds route spec. The host injects the renderer and projector at mount, so the factory takes
 * no collaborators. */
export function createTemplatePreviewEmbedsRoute<TOutput>(_required: Record<string, never>, _optional: Record<string, never> = {}): PreviewEmbedsRouteSpec<TOutput> {
  const spec = defineJsonRoute<PreviewEmbedsInput, TOutput, PreviewEmbedsRouteDeps<TOutput>, PreviewEmbedsPrincipal>({
    method: "post",
    path: "/api/admin/v1/workspaces/:workspaceId/posts/:postId/template-preview/embeds",
    parse: (raw) => ok({ value: { postId: raw.params["postId"] ?? "", rawTemplateChoice: raw.query["templateChoice"], body: raw.body } }),
    handle: async ({ input, deps, context, authorize }, optional = {}) => {
      if (!context) throw new RouteRefusalError({ status: 401, body: { error: "authentication required" } });
      await authorizeRead({ authorize });
      const { html } = await deps.renderPreview(input, { signal: optional.signal });
      return ok({ value: deps.projectEmbeds({ iframeSources: collectIframeSources({ html }) }) });
    },
  });
  return { ...spec, responseHeaders: RESPONSE_HEADERS };
}

/**
 * @file The host's projector for the template-preview embed inspection route
 * (`@jini-ai/cms/admin-http/routes/posts/template-preview-embeds`): turns the rendered preview's
 * ordered iframe `src` strings into validated YouTube video ids for the Page Preview links.
 *
 * Why only ids: the JSON endpoint sees the same authorized draft render the sandboxed HTML preview
 * serves, but the admin frame must never read that document (no `allow-same-origin`). Returning a
 * validated 11-character id — and discarding every other part of each URL — gives the editor its
 * "Watch on YouTube" links without exposing any rendered HTML, query string or third-party URL.
 * Pure string work: no redirects, network calls or script execution.
 */

/** Exact origins (scheme + host + default port) that may contribute an id, and the path shape each allows. */
const LONG_HOSTS: ReadonlySet<string> = new Set(["youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const SHORT_HOST = "youtu.be";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The id in one source, or `undefined` when the source is not an exact allowed embed URL.
 * @complexity O(n) in the source length (one URL parse). */
function youtubeIdOf({ source }: { source: string }, _optional: Record<string, never> = {}): string | undefined {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }
  // `URL` drops a default `:443`, so any remaining port is nonstandard; credentials are refused outright.
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  const segments = url.pathname.split("/");
  if (url.hostname === SHORT_HOST) return segments.length === 2 && VIDEO_ID.test(segments[1] ?? "") ? segments[1] : undefined;
  if (!LONG_HOSTS.has(url.hostname) || segments.length !== 3 || segments[1] !== "embed") return undefined;
  return VIDEO_ID.test(segments[2] ?? "") ? segments[2] : undefined;
}

/** Validated YouTube ids from the preview's iframe sources, deduplicated in first-seen order.
 * @complexity O(total source length). */
export function projectPreviewYoutubeIds(
  { iframeSources }: { iframeSources: readonly string[] },
  _optional: Record<string, never> = {},
): { youtubeIds: string[] } {
  const seen = new Set<string>();
  for (const source of iframeSources) {
    const id = youtubeIdOf({ source });
    if (id !== undefined) seen.add(id);
  }
  return { youtubeIds: [...seen] };
}

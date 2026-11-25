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

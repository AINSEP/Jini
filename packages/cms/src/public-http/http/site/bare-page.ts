import { renderBareDocument } from "../../../presentation/document-shell.js";
import type { DocumentAssets } from '../../../presentation/index.js';
import type { PostRecord } from "../../../posts/post.js";
import type { ResolveHtmlPageEmbedsResult } from "../../../widgets/html/index.js";
import type { WidgetRenderIR } from "../../../widgets/index.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { BodyRenderPorts } from "./render/body-render-ports.js";

/**
 * @file Bare-page document renderer (owner ruling 2026-09-23, `no-template-bare-plan-2026-09-23.md`
 * S3) — the renderer for a Page whose author explicitly picked "No template chosen"
 * (`templateChoice === ""`, `isBarePageChoice` in `features/theme/static-render.ts`). Produces ONLY
 * the Page's own HTML: no theme CSS/JS, no `data-theme`, no `site-header`/`site-footer`, no
 * site-assistant widget. The one thing this module still adds is the SEO/og head fold, via the
 * pre-built `extraHead` string the caller (`routes/site/pages.ts`'s `renderBarePage`, S4/S5) already
 * resolves through the SAME `buildExtraHead`/`foldPageHead` pipeline every other route uses — this
 * module never builds its own SEO markup, and never imports `page-head.ts` directly.
 *
 * Pure and synchronous, mirroring `render.ts`'s own "caller resolves, this renders" convention: every
 * input here is already resolved (no repo reads, no I/O), so the same post/extraHead/embeds always
 * produce the same document.
 */

/** {@link renderBareEntryDocument}'s own empty default for `widgetInlineResolved` — mirrors
 *  `render.ts`'s private `EMPTY_INLINE_RESOLVED`, which this module cannot import (not exported). */
const EMPTY_INLINE_RESOLVED: ReadonlyMap<string, WidgetRenderIR> = new Map();
/** {@link renderBareEntryDocument}'s own empty default for `mediaTransformVersions` — see
 *  {@link EMPTY_INLINE_RESOLVED}'s doc for why this is a local copy, not an import. */
const EMPTY_MEDIA_TRANSFORM_VERSIONS: ReadonlyMap<string, number> = new Map();
/** {@link renderBareEntryDocument}'s own empty default for `mediaAssetMetadata` — see
 *  {@link EMPTY_INLINE_RESOLVED}'s doc for why this is a local copy, not an import. */
const EMPTY_MEDIA_ASSET_METADATA: ReadonlyMap<string, MediaAssetRenderMeta> = new Map();

/** {@link renderBareEntryDocument}'s required input. Every optional field defaults exactly the way
 *  `render.ts`'s `buildSiteRenderContext` already defaults the same fields for `renderSite`, so a
 *  caller that only has a post/siteTitle (no widgets, no embeds) still gets a valid document. */
export interface RenderBareEntryDocumentRequired {
  /** Host assets join only documents this renderer constructs; authored full documents stay intact. */
  documentAssets?: DocumentAssets | undefined;
  post: PostRecord;
  siteTitle: string;
  /** SPEC-008 T049 — the caller's pre-built SEO/og head fold (`pages.ts`'s `buildExtraHead`), spliced
   *  in verbatim. Omitted degrades to no extra head tags, never a crash. */
  extraHead?: string;
  /** SPEC-047 Slice 2 — an `"html"`-format Page's pre-resolved `data-embed-type` targets, threaded
   *  straight into {@link renderHtmlPageBody}. Omitted degrades to every marker resolving to the
   *  REQ-28 placeholder, that function's own existing contract. */
  pageHtmlEmbeds?: ResolveHtmlPageEmbedsResult | undefined;
  /** SPEC-043/ADR-047 W-004 — a `"doc"`-format Page's pre-resolved inline widget embeds, threaded
   *  straight into {@link renderDocNode}. Omitted degrades to empty, same as that function's own
   *  default parameter. */
  widgetInlineResolved?: ReadonlyMap<string, WidgetRenderIR>;
  /** ADR-027 §4 — threaded straight into {@link renderDocNode}'s `image` case. Omitted degrades to
   *  empty (every ref-based image renders its placeholder), same as that function's own default. */
  mediaTransformVersions?: ReadonlyMap<string, number>;
  /** Owner-directed public-render sizing fix — threaded straight into {@link renderDocNode}'s `image`
   *  case. Omitted degrades to empty (no width/height/class override), same as that function's own
   *  default. */
  mediaAssetMetadata?: ReadonlyMap<string, MediaAssetRenderMeta>;
}

/**
 * Renders a bare Page (`templateChoice === ""`) to a complete HTML document. `post.bodyFormat` picks
 * the body path the same way `renderPostBody` (`render.ts`) does: `"html"` substitutes embed markers
 * via {@link renderHtmlPageBody}; anything else walks `post.bodyJson` via {@link renderDocNode}.
 * Unlike `renderPostBody`, no assigned-terms block is appended afterward — bare means only the page's
 * own authored content, and assigned terms are the theme layer's "filed under" footer (plan §3).
 *
 * An `"html"`-format body that is already a complete document ({@link isFullHtmlDocument} on the RAW
 * `post.bodyHtml`, before embed substitution) is returned through unchanged apart from embed
 * resolution: no SEO fold, no wrapping, no injected `<title>`. The author owns their own `<head>` in
 * that case — injecting would produce duplicate `<title>`/meta tags (plan §3, point 1). Detection
 * reads the RAW body rather than the embed-resolved one because embed substitution can only ever
 * replace marker elements *inside* the document, never introduce or remove the leading
 * doctype/`<html>` prefix this check inspects — so the two are equivalent for this decision, and
 * reading the raw string keeps the check independent of `pageHtmlEmbeds` being provided at all.
 *
 * @complexity O(n) over the body's length: one embed-substitution or doc-walk pass (whichever body
 * path applies), plus {@link isFullHtmlDocument}'s own O(n) scan for an `"html"`-format body.
 */
export function renderBareEntryDocument(required: RenderBareEntryDocumentRequired & { renderers: BodyRenderPorts }, _optional = {}): string {
  const { post } = required;
  const title = `${post.title} — ${required.siteTitle}`;
  if (post.bodyFormat === "html") {
    const rawBodyHtml = post.bodyHtml ?? "";
    const resolvedBody = required.renderers.renderHtmlPageBody({ html: rawBodyHtml, resolved: required.pageHtmlEmbeds });
    return renderBareDocument({ title, body: resolvedBody }, { authoredHtml: rawBodyHtml, ...(required.extraHead === undefined ? {} : { extraHead: required.extraHead }), ...(required.documentAssets === undefined ? {} : { documentAssets: required.documentAssets }) });
  }
  const body = required.renderers.renderDocNode(
    { node: post.bodyJson },
    {
      inlineResolved: required.widgetInlineResolved ?? EMPTY_INLINE_RESOLVED,
      mediaTransformVersions: required.mediaTransformVersions ?? EMPTY_MEDIA_TRANSFORM_VERSIONS,
      mediaAssetMetadata: required.mediaAssetMetadata ?? EMPTY_MEDIA_ASSET_METADATA,
    },
  );
  return renderBareDocument({ title, body }, { ...(required.extraHead === undefined ? {} : { extraHead: required.extraHead }), ...(required.documentAssets === undefined ? {} : { documentAssets: required.documentAssets }) });
}

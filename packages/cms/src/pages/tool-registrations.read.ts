import { requireInputRecord, requireString, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/index.js";
import type { PagesToolDeps, buildPagesRegistrations } from "./tool-registrations.js";
import { PageNotFoundError } from "./html-document-store.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { requireCapturedVersion, requireRegion } from "./tool-registrations.shared.js";


/** Read an existing doc page after the HTML store reports no bespoke body. */
async function readDocPageFallback<D extends PagesToolDeps>(
  { deps, id, err, host }: { deps: D; id: string; err: unknown; host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"] },
  _options: Record<string, never> = {},
) {
  if (!(err instanceof PageNotFoundError)) throw err;
  // A page that exists but has never been given HTML is the common case on a brand-new
  // page, and it is not an error — telling the model "not found" here would send it looking
  // for a different id instead of writing the page it was asked to write. Distinguish the
  // two by asking the repo whether the row exists at all.
  const row = await deps.postRepo.findById({ workspaceId: deps.workspaceId, id });
  // S2 (fix plan 2026-09-24, rows 13 + 18-pages) — a trashed row still 404s (matches every
  // other pages tool's Trash handling: `read()`/`ensureHtmlFormat()` both refuse a trashed
  // row rather than reporting its pre-trash state).
  if (!row || row.kind !== "page" || isTrashed(row)) throw err;
  // A `doc`-format Page with real authored content is NOT the same "nothing here yet"
  // case an empty, freshly-created Page is — see this function's `note` below for why the
  // model must be told before it calls `pages_write_html` and silently discards it.
  const hasDocContent = Array.isArray(row.bodyJson.content) && row.bodyJson.content.length > 0;
  // Without this the model sees an empty page and any addition erases the owner's text and form.
  const html = hasDocContent && deps.docBodyAsPageHtml ? deps.docBodyAsPageHtml({ bodyJson: row.bodyJson }) : "";
  return {
    id,
    html,
    regions: [],
    bodyFormat: row.bodyFormat,
    version: row.version,
    hasDocContent,
    theme: await host.readTheme({ deps }),
    ...docPageNote({ hasDocContent, html }),
  };
}

/** The `note` telling the model a doc page already has content, and what writing HTML does to it. */
function docPageNote({ hasDocContent, html }: { hasDocContent: boolean; html: string }, _options: Record<string, never> = {}) {
  return hasDocContent
    ? {
        note: html
          ? "This rich-text (doc) page is shown here as HTML. Keep rich text for routine edits and reserve conversion for an explicit format change."
          : "This page is a rich-text (doc) page with content. Keep rich text for routine edits and reserve conversion for an explicit format change.",
      }
    : {};
}

    // Resolve against this handler's site dependencies, after scope selection and permission checks.
    // Region selection stays outside the document fallback so a failed lookup cannot return a full page.
    export async function readPageHtml<D extends PagesToolDeps>({ routeDeps, ctx, host }: { routeDeps: D; ctx: Parameters<ToolHandler>[0]; host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"] }, _optional = {}) {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "content.read" }, { entityType: "post" });

      const id = requireString({ input, key: "id" });
      const store = routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: id, actorId: ctx.principal.id });

      let page;
      try {
        const html = await store.read();
        // `version` is the basis a writer states back as `expectedVersion` — see
        // `PagesHtmlDocumentStorePort.capturedVersion` for why it comes off the store rather than off
        // a second row read.
        page = { id, html, version: requireCapturedVersion(store), theme: await host.readTheme({ deps: routeDeps }) };
      } catch (err) {
        page = await readDocPageFallback({ deps: routeDeps, id, err, host });
      }
      const scan = host.regions.scanHtmlRegions({ html: page.html });
      const result = { ...page, regions: host.regions.regionHandlesIn({ scan }) };
      if (input.regionId === undefined) return result;
      const region = requireRegion({ scan, id, handle: requireString({ input, key: "regionId" }), regions: host.regions });
      return { ...result, html: page.html.slice(region.start, region.end) };
    }



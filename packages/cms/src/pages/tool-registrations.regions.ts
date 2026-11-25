import { ToolInputError, requireInputRecord, requireString, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/index.js";
import type { PagesToolDeps, buildPagesRegistrations } from "./tool-registrations.js";
// Core keeps missing/malformed bases model-facing: ToolInputError survives delegated transport's
// internal-error redaction, so the model receives the read-and-retry instruction.
import { requireExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import { requirePageAuthoringHtml } from "./authoring-html.js";
import { describeScriptRevealedContent } from "./hidden-until-script.js";
import { PageNotFoundError } from "./html-document-store.js";
import { requireCapturedVersion, assertExpectedVersion, toModelFacingWriteError, describeRegionProblem, requireRegion, describeUnsafeRegions, joinWarnings, describeHandleCollision, parseMovePlacement, describeMoveProblem, writeOnBasis, recordPageWrite, undoField, embedWarningMessages } from "./tool-registrations.shared.js";


    /**
     * The one-section edit. Read, splice, version-conditioned write — server-side, so the model
     * never has to hold or re-emit the rest of the document.
     */
    export async function writePageRegion<D extends PagesToolDeps>({ routeDeps, ctx, host }: { routeDeps: D; ctx: Parameters<ToolHandler>[0]; host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"] }, _optional = {}) {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.editHtmlPermission }, { entityType: "post" });

      const id = requireString({ input: input, key: "id" });
      const handle = requireString({ input: input, key: "regionId" });
      const fragment = requirePageAuthoringHtml({ html: requireString({ input: input, key: "html" }) });
      const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: "pages_read_html" });
      const store = routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: id, actorId: ctx.principal.id });

      let current: string;
      try {
        current = await store.read();
      } catch (err) {
        if (err instanceof PageNotFoundError) {
          // Deliberately NOT converted here, unlike `pages_write_html`. A region write addresses
          // something that already exists; there is no region to target in a body that was never
          // authored, and quietly birthing one would make this tool a second, undeclared page
          // creator. Same model-facing-reason shape the kind-mismatch branch above uses, and it
          // covers a post id too — `read()` masks the two by design.
          return {
            written: false,
            reason:
              `'${id}' has no bespoke HTML body to edit a region of. Either it is a post (posts are edited with ` +
              "content_post_update), or it is a page nobody has authored yet — author it in full with " +
              "pages_write_html first, then edit its regions.",
          };
        }
        throw err;
      }

      const basis = requireCapturedVersion(store);
      assertExpectedVersion({ id, expectedVersion, basis });

      const scan = host.regions.scanHtmlRegions({ html: current });
      const lookup = host.regions.locateRegion({ scan, handle });
      if ("problem" in lookup) throw new ToolInputError({ message: describeRegionProblem({ id, handle, problem: lookup.problem }) });

      // Inner-only replacement preserves the address, classes and aria attributes by construction;
      // asking the model to re-emit the whole element would let a typo erase the address being edited.
      const next = host.regions.replaceRegionInner({ html: current, region: lookup.region, fragment });
      const nextScan = next === current ? scan : host.regions.scanHtmlRegions({ html: next });
      // Check every handle brought in by the fragment, not only the target. Comparing with the
      // stored scan keeps legacy duplicates editable elsewhere; only worsened ambiguity is refused.
      const madeAmbiguous = host.regions.handlesMadeAmbiguous({ before: scan, after: nextScan });
      if (madeAmbiguous.length > 0) {
        // Returned, not thrown, like the other refusals the model fixes by changing its own input:
        // here it only has to drop or rename the reused handle in its fragment.
        return { written: false, reason: describeHandleCollision({ id, handle, collisions: madeAmbiguous }) };
      }
      let changeSetId: string | undefined;
      try {
        ({ changeSetId } = await recordPageWrite({ routeDeps, host, ctx, id, expectedVersion, operation: "pages_write_region", write: () => writeOnBasis({ store, html: next, basis }) }));
      } catch (err) {
        throw toModelFacingWriteError({ err });
      }

      const warning = joinWarnings({ warnings: [describeScriptRevealedContent({ html: fragment }), describeUnsafeRegions({ scan: nextScan }), ...embedWarningMessages({ store })] });
      return {
        written: true,
        id,
        handle,
        // The handles that SURVIVED this write, not the ones that went in. Replacing a region that
        // contained other regions removes them, and a model targeting a handle it saw two turns ago
        // is the failure that makes handle churn worse than no handles at all.
        regions: host.regions.regionHandlesIn({ scan: nextScan }),
        version: requireCapturedVersion(store),
        ...undoField({ changeSetId }),
        ...warning,
      };
    }


    /**
     * The section reorder. Read, cut-and-reinsert one whole region element, version-conditioned
     * write — so "swap these two sections" never means re-sending the page.
     */
    export async function movePageRegion<D extends PagesToolDeps>({ routeDeps, ctx, host }: { routeDeps: D; ctx: Parameters<ToolHandler>[0]; host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"] }, _optional = {}) {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.editHtmlPermission }, { entityType: "post" });

      const id = requireString({ input: input, key: "id" });
      const handle = requireString({ input: input, key: "regionId" });
      const { placement, targetHandle } = parseMovePlacement(input);
      const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: "pages_read_html" });
      const store = routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: id, actorId: ctx.principal.id });

      let current: string;
      try {
        current = await store.read();
      } catch (err) {
        if (!(err instanceof PageNotFoundError)) throw err;
        return {
          written: false,
          reason:
            `'${id}' has no bespoke HTML body to move a region of. Either it is a post (posts are edited with ` +
            "content_post_update), or it is a page nobody has authored yet — author it in full with pages_write_html first.",
        };
      }
      const basis = requireCapturedVersion(store);
      assertExpectedVersion({ id, expectedVersion, basis });

      const scan = host.regions.scanHtmlRegions({ html: current });
      const moved = host.regions.moveRegion({ html: current, moving: requireRegion({ scan, id, handle, regions: host.regions }), target: requireRegion({ scan, id, handle: targetHandle, regions: host.regions }), placement });
      if ("problem" in moved) {
        return { written: false, reason: describeMoveProblem({ handle, targetHandle, placement, problem: moved.problem }) };
      }
      if (moved.html === current) {
        return {
          written: false,
          reason:
            `Nothing was written: '${handle}' already sits immediately ${placement} '${targetHandle}'. ` +
            `Current order: ${host.regions.regionHandlesIn({ scan }).join(", ")}.`,
        };
      }
      let changeSetId: string | undefined;
      try {
        ({ changeSetId } = await recordPageWrite({ routeDeps, host, ctx, id, expectedVersion, operation: "pages_move_region", write: () => writeOnBasis({ store, html: moved.html, basis }) }));
      } catch (err) {
        throw toModelFacingWriteError({ err });
      }
      const movedScan = host.regions.scanHtmlRegions({ html: moved.html });
      return { written: true, id, handle, regions: host.regions.regionHandlesIn({ scan: movedScan }), version: requireCapturedVersion(store), ...undoField({ changeSetId }), ...joinWarnings({ warnings: embedWarningMessages({ store }) }) };
    }






import { requireInputRecord, requireString, type ToolHandler } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/index.js";
import type { PagesToolDeps, buildPagesRegistrations } from "./tool-registrations.js";
// Core keeps missing/malformed bases model-facing: ToolInputError survives delegated transport's
// internal-error redaction, so the model receives the read-and-retry instruction.
import { requireExpectedVersion } from "@jini-ai/core/optimistic-concurrency";
import { requirePageAuthoringHtml } from "./authoring-html.js";
import { describeScriptRevealedContent } from "./hidden-until-script.js";
import { PageNotFoundError, PageKindMismatchError } from "./html-document-store.js";
import type { PageHtmlRegionPorts, HtmlRegionScan } from "@jini-ai/core/contracts/site/html-region-ports";
import type { PagesHtmlDocumentStorePort } from "@jini-ai/core/contracts/site/page-html-store";
import type { PostRepoPort } from "../posts/post.js";
import { requireCapturedVersion, assertExpectedVersion, toModelFacingWriteError, assertTopLevelSectionsAreTagged, describeUnsafeRegions, joinWarnings, describeFullWriteHandleCollision, writeOnBasis, recordPageWrite, undoField, embedWarningMessages } from "./tool-registrations.shared.js";


/** What {@link openForFullWrite} resolved: the write's version basis, or the handles that refuse it. */
type FullWriteOpening = { readonly basis: number | null } | { readonly madeAmbiguous: readonly string[] };

/**
 * Open a page for a full-body write and return the version the pending write will be conditioned on
 * (`null` when this call is the page's FIRST html write), or the handles `seedHtml` would newly put
 * on more than one element — in which case nothing was converted and nothing may be written.
 *
 * The read comes BEFORE the format conversion on purpose. `ensureHtmlFormat` on a `doc`-format row
 * is itself a version-bumping write, so a version captured after it can never equal the basis a
 * caller read beforehand — checking there would reject every legitimate first write and accept
 * nothing extra. Reading first separates the two cases cleanly: an existing html page yields the
 * live version (and the guard applies), and a page with no body yet yields `null` (and there was
 * never a basis to state).
 *
 * The duplicate-handle check also runs here, between the read and the conversion, because that is
 * the only point that has the current body in hand AND has not yet converted anything: `html` is
 * compared against the stored body, or against an empty document when there is none (a first
 * write, whose every duplicate is therefore new). Same rule as `pages_write_region`: only a write
 * that ADDS ambiguity is refused, so a legacy page carrying a duplicate can still be rewritten.
 *
 * S2 (fix plan 2026-09-24, rows 13 + 18-pages) — a caller CAN state a basis for that first-write
 * case now, when it is converting an existing `doc`-format row rather than birthing a genuinely
 * empty page: `pages_read_html` (see its own `hasDocContent`/`note`) tells the model the row's real
 * `version` before it ever calls this, so a stale basis on the conversion turn is exactly as real a
 * conflict as a stale basis on any later write, and is checked here against the row `findById`
 * returns — the one extra SELECT the not-found branch now costs, paid only on the conversion path.
 * A row that does not exist at all (`findById` returns `null`) has no version to check, so the
 * guard is skipped and `ensureHtmlFormat`'s own `PageNotFoundError` reaches the caller unchanged.
 *
 * @throws {PageNotFoundError} If no such row exists at all.
 * @throws {PageKindMismatchError} If the id names a post.
 * @throws {ToolInputError} If a stated `expectedVersion` does not match an existing `doc` row's
 * real version (via {@link assertExpectedVersion}).
 * @complexity O(n + r log r) for the stored HTML scan, plus one indexed read and (on the conversion
 * path) one indexed lookup and one indexed update. The proposed HTML scan is supplied by the caller.
 */
export async function openForFullWrite(
  { store, seedHtml, scan, guard, regions }: {
    regions: PageHtmlRegionPorts;
    store: PagesHtmlDocumentStorePort;
    seedHtml: string;
    scan: HtmlRegionScan;
    guard: { postRepo: PostRepoPort; workspaceId: string; id: string; expectedVersion: number };
  },
  _options: Record<string, never> = {},
): Promise<FullWriteOpening> {
  let current: string | null = null;
  try {
    current = await store.read();
  } catch (err) {
    if (!(err instanceof PageNotFoundError)) throw err;
  }
  const before = current === seedHtml ? scan : regions.scanHtmlRegions({ html: current ?? "" });
  const madeAmbiguous = regions.handlesMadeAmbiguous({ before, after: scan });
  if (madeAmbiguous.length > 0) return { madeAmbiguous };
  if (current !== null) return { basis: requireCapturedVersion(store) };

  const row = await guard.postRepo.findById({ workspaceId: guard.workspaceId, id: guard.id });
  if (row) assertExpectedVersion({ id: guard.id, expectedVersion: guard.expectedVersion, basis: row.version });
  await store.ensureHtmlFormat({ seedHtml, expectedVersion: guard.expectedVersion });
  return { basis: null };
}

    export async function writePageHtml<D extends PagesToolDeps>({ routeDeps, ctx, host }: { routeDeps: D; ctx: Parameters<ToolHandler>[0]; host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"] }, _optional = {}) {
      const input = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.editHtmlPermission }, { entityType: "post" });

      const id = requireString({ input: input, key: "id" });
      const html = requirePageAuthoringHtml({ html: requireString({ input: input, key: "html" }) });
      const expectedVersion = requireExpectedVersion({ value: input.expectedVersion, readToolId: "pages_read_html" });
      // Before anything is opened or converted, so a refused write leaves the row exactly as it was
      // — including a `doc`-format row that would otherwise have been converted one-way by
      // `ensureHtmlFormat` on the way to a rejection.
      // Malformed HTML adds no refusal here; it is warned about per region after the write.
      const scan = host.regions.scanHtmlRegions({ html });
      assertTopLevelSectionsAreTagged({ html, scan, regions: host.regions });

      const store = routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: id, actorId: ctx.principal.id });

      let changeSetId: string | undefined;
      try {
        const recorded = await recordPageWrite({ routeDeps, host, ctx, id, expectedVersion, operation: "pages_write_html", write: async () => {
          const opening = await openForFullWrite({ store, seedHtml: html, scan, regions: host.regions, guard: { postRepo: routeDeps.postRepo, workspaceId: routeDeps.workspaceId, id, expectedVersion } });
          // Returned, not thrown, like the region writer's collision refusal: the fix is in the model's own input.
          if ("madeAmbiguous" in opening) return { changed: false, version: null, value: { written: false as const, reason: describeFullWriteHandleCollision({ id, collisions: opening.madeAmbiguous }) } };
          if (opening.basis !== null) assertExpectedVersion({ id, expectedVersion, basis: opening.basis });
          return { ...(await writeOnBasis({ store, html, basis: opening.basis })), value: null };
        } });
        if (recorded.value) return recorded.value;
        changeSetId = recorded.changeSetId;
      } catch (err) {
        if (err instanceof PageKindMismatchError) {
          // Surfaced as a model-facing reason rather than a thrown error: this is a mistake the
          // model can fix on its next turn (it aimed a page tool at a post id), and the fix is to
          // pick a different id, which it can only do if it is told that is the problem.
          return {
            written: false,
            reason:
              `'${id}' is a post, not a page. Posts are edited as rich-text documents through ` +
              "content_post_update; only pages have a bespoke HTML body. Use content_post_list with " +
              "kind:'page' to find the right id, or content_post_create with kind:'page' to make one.",
          };
        }
        throw toModelFacingWriteError({ err });
      }

      // A warning, not a refusal: hidden-until-script markup copied from another site is a fixable
      // mistake, but a deliberately hidden element is legal (see `@jini-ai/cms/pages/hidden-until-script`).
      const warning = joinWarnings({ warnings: [describeScriptRevealedContent({ html }), describeUnsafeRegions({ scan }), ...embedWarningMessages({ store })] });
      return { written: true, id, regions: host.regions.regionHandlesIn({ scan }), version: requireCapturedVersion(store), ...undoField({ changeSetId }), ...warning };
    }



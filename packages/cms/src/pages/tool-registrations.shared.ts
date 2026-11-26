import { ToolInputError, requireString, type ToolHandler } from "@jini-ai/core";
import { VERSION_CONFLICT_CODE } from "@jini-ai/core/optimistic-concurrency";
import { PageConcurrentEditError } from "./html-document-store.js";
import type { PageHtmlOperation, PageHtmlWriteOutcome, PagesHtmlDocumentStorePort } from "@jini-ai/core/contracts/site/page-html-store";
import type { PageHtmlRegionPorts, HtmlRegionScan, ScannedRegion, RegionLookupProblem, RegionMoveProblem } from "@jini-ai/core/contracts/site/html-region-ports";
import { toSlug } from "../html/site/slug.js";
import type { PagesToolDeps, buildPagesRegistrations } from "./tool-registrations.js";

/**
 * The version the store captured on its most recent read — the exact predicate its next `write()`
 * will use.
 *
 * Throws rather than returning `null` because every call site here has just completed a successful
 * `read()`/`ensureHtmlFormat()`: a `null` at this point is a store implementation that stopped
 * capturing, not a runtime condition, and silently treating it as "no basis" would disable the
 * version guard exactly when it is most needed.
 *
 * @complexity O(1).
 */
export function requireCapturedVersion(store: PagesHtmlDocumentStorePort): number {
  const version = store.capturedVersion();
  if (version === null) {
    throw new Error("pages tool: the store captured no version after a successful read — the write guard has nothing to condition on");
  }
  return version;
}

/**
 * Compare the caller's stated basis against the version the pending write is conditioned on.
 *
 * `ToolInputError` carrying {@link VERSION_CONFLICT_CODE}, for the identical reason
 * `features/post`'s `toModelFacingUpdateError` reclassifies its own conflict: an unmarked rejection
 * reaches the model through `/api/delegated-tool-calls` as a message-stripped INTERNAL_ERROR, so the
 * one thing it most needs to know — that its edit did not land and re-reading fixes it — would never
 * arrive. The classification is honest rather than a trick: a stale basis IS a caller-input problem
 * that a different (freshly re-read) input resolves.
 *
 * @throws {ToolInputError} When the required basis does not match.
 * @complexity O(1).
 */
export function assertExpectedVersion(required: { id: string; expectedVersion: number; basis: number }): void {
  const { id, expectedVersion, basis } = required;
  if (expectedVersion === basis) return;
  throw new ToolInputError({ message: `${VERSION_CONFLICT_CODE}: page '${id}' is at version ${basis}, not the version ${expectedVersion} you based this edit on. ` +
      "Someone else saved it after you read it, so your edit was NOT applied and nothing was overwritten. " +
      "Re-read the page with pages_read_html, reapply your change on top of the body you get back, and resend " +
      "with that version. Do not resend this call unchanged." });
}

/**
 * Reclassify the store's compare-and-set rejection on its way to the model; pass everything else
 * through untouched.
 *
 * The window this catches is narrower than {@link assertExpectedVersion}'s and is not the same
 * check: a writer can land between this turn's `read()` and its `write()` after the caller
 * supplied a matching basis, and `PagesHtmlDocumentStore` refuses that write by design (CIC-1). Before this,
 * both page writers let that rejection propagate as a bare `Error`, which the delegated transport
 * redacts — so a genuine concurrent edit reached the model as an unexplained server error.
 *
 * @complexity O(1).
 */
export function toModelFacingWriteError({ err }: { err: unknown }, _optional = {}): unknown {
  if (!(err instanceof PageConcurrentEditError)) return err;
  return new ToolInputError({ message: `${VERSION_CONFLICT_CODE}: ${err.message}. Nothing was written. Re-read the page with pages_read_html, ` +
      "reapply your change to the body you get back, and resend." });
}

/**
 * Refuse a full-page write whose top-level sections carry no `data-agent-element` handle.
 *
 * **Refused at the write seam, not repaired by a postprocessor.** A repair pass would make the
 * stored page differ from the markup the model just emitted — the model would be told it succeeded,
 * learn nothing, and emit untagged markup again on the next turn, while the operator's page silently
 * contains attributes nobody wrote. Refusing puts the correction on the turn the mistake was made,
 * in the only channel the model reads.
 *
 * The suggested handles are ADVICE, not an edit: they come from each section's own heading text
 * (`suggestRegionHandle`), so they are stable across turns and across insertions, and a suggestion
 * that would collide with a handle already in the document is withheld rather than offered.
 * Positional handles would address a different section after an insertion or move; a section
 * without a heading gets no suggestion rather than an unstable positional fallback.
 *
 * Only top-level content needs a handle. Requiring one on every nested div would silently impose
 * a stricter contract; requiring one on a stylesheet would invent an address nobody edits.
 *
 * @throws {ToolInputError} Naming every offending element and, where one can be derived, the handle
 * it should carry.
 * @complexity O(n) in the markup's length.
 */
export function assertTopLevelSectionsAreTagged(
  { html, scan, regions }: { html: string; scan: HtmlRegionScan; regions: PageHtmlRegionPorts },
  _options: Record<string, never> = {},
): void {
  const offenders = regions.untaggedTopLevelSections({ html, scan }, { slugify: (text) => toSlug({ text }) });
  if (offenders.length === 0) return;
  const listed = offenders
    .map((offender) =>
      offender.suggestedHandle === undefined
        ? `<${offender.tag}> (pick a short, content-derived handle for it)`
        : `<${offender.tag}> (suggested handle: "${offender.suggestedHandle}")`
    )
    .join("; ");
  throw new ToolInputError({ message: `This page was NOT written. ${offenders.length} top-level element(s) carry no data-agent-element handle: ${listed}. ` +
      'Wrap each one as `<section data-agent-element="<handle>" data-agent-role="region"> ... </section>` and resend. ' +
      "Handles are how any later turn edits one part of this page instead of rewriting all of it, so an untagged " +
      "page is a page that can only ever be replaced wholesale. Name handles after what the section IS " +
      "(\"pricing\", \"faq\"), never after its position — a positional handle goes stale the moment a section moves. " +
      "Only <style> and other metadata elements may sit at the top level untagged." });
}

/**
 * Turn a failed handle lookup into the sentence that lets the model fix it on its next call.
 *
 * Every branch names what to do rather than only what went wrong: an absent handle lists the ones
 * that exist (deduplicated — the same handle appearing twice is the ambiguity case, and repeating it
 * in the "available" list would read as two options), and an ambiguous one says which tool resolves
 * it, since `pages_write_region` structurally cannot.
 *
 * @complexity O(r) in the document's region count.
 */
export function describeRegionProblem({ id, handle, problem }: { id: string; handle: string; problem: RegionLookupProblem }, _optional = {}): string {
  if (problem.kind === "ambiguous") {
    return (
      `Nothing was written: ${problem.count} elements in page '${id}' carry data-agent-element="${handle}", so that handle ` +
      "is not an address — a write to it could land in either one. Fix the duplicate with pages_write_html (give each " +
      "section its own handle), then edit the region you meant."
    );
  }
  if (problem.kind === "not-replaceable") {
    return (
      `Nothing was written: the <${problem.tag}> carrying data-agent-element="${handle}" in page '${id}' has no closing ` +
      "tag in the stored markup, so it delimits no content to replace. Repair the page with pages_write_html."
    );
  }
  const available = [...new Set(problem.available)];
  const list = available.length === 0 ? "it has none at all" : `it has: ${available.join(", ")}`;
  return (
    `Nothing was written: page '${id}' has no region with data-agent-element="${handle}" — ${list}. ` +
    "Call pages_read_html to see the current handles, and target one of those; if the section you want does not exist " +
    "yet, add it with pages_write_html."
  );
}

/**
 * The single region `handle` addresses in page `id`'s body.
 *
 * @throws {ToolInputError} With {@link describeRegionProblem}'s sentence when it is absent, ambiguous
 * or unclosed.
 *
 * A handle is an address: choosing the first duplicate could silently edit the wrong section.
 * Nesting remains legal; writing an outer region removes its nested handles, so writers report
 * the surviving handles. A problem on another region never locks this one out.
 *
 * @complexity O(r) in the scan's region count; no I/O or parsing.
 */
export function requireRegion(
  { scan, id, handle, regions }: { scan: HtmlRegionScan; id: string; handle: string; regions: PageHtmlRegionPorts },
  _options: Record<string, never> = {},
): ScannedRegion {
  const lookup = regions.locateRegion({ scan, handle });
  if ("problem" in lookup) throw new ToolInputError({ message: describeRegionProblem({ id, handle, problem: lookup.problem }) });
  return lookup.region;
}

/**
 * The saved document's unsafe regions as one warning, or undefined when every region is safe.
 *
 * Owner rule (2026-10-24): malformed HTML WARNS per region and never refuses the save. A legacy page
 * with one stray tag must stay writable; only the unsafe handle is later refused by
 * {@link requireRegion}, so the model is told now which handles that will be.
 *
 * @complexity O(r) in the scan's region count.
 */
export function describeUnsafeRegions(
  { scan }: { scan: HtmlRegionScan },
  _options: Record<string, never> = {},
): string | undefined {
  const problems = scan.regions.flatMap((region) => (region.problem === undefined ? [] : [region.problem]));
  if (scan.documentProblem !== undefined) problems.push(scan.documentProblem);
  if (problems.length === 0) return undefined;
  return `Written, but pages_write_region and pages_move_region will refuse these until the markup is repaired: ${problems.join("; ")}`;
}

/** Join the optional warnings a write reports, keeping the field absent when there are none. */
export function joinWarnings(
  { warnings }: { warnings: readonly (string | undefined)[] },
  _options: Record<string, never> = {},
): { warning?: string } {
  const present = warnings.filter((warning): warning is string => warning !== undefined);
  return present.length === 0 ? {} : { warning: present.join(" ") };
}

/**
 * The refusal for a region fragment that would leave some handle on more than one element.
 *
 * @complexity O(k) in the offending handle count.
 */
export function describeHandleCollision({ id, handle, collisions }: { id: string; handle: string; collisions: readonly string[] }, _optional = {}): string {
  const quoted = collisions.map((collision) => `"${collision}"`).join(", ");
  return (
    `Nothing was written: the html for region "${handle}" carries data-agent-element=${quoted}, which ` +
    `page '${id}' already uses, so that handle would stop addressing a single region. Remove or rename ` +
    "that attribute in the fragment (each handle must be unique across the whole page), then write the region again."
  );
}

/**
 * The refusal for a full-page write that would leave some handle on more than one element.
 *
 * @complexity O(k) in the offending handle count.
 */
export function describeFullWriteHandleCollision({ id, collisions }: { id: string; collisions: readonly string[] }, _optional = {}): string {
  const quoted = collisions.map((collision) => `"${collision}"`).join(", ");
  return (
    `Nothing was written: the html for page '${id}' puts data-agent-element=${quoted} on more than one element, ` +
    "so that handle would stop addressing a single region. Give each section its own handle (each handle must be " +
    "unique across the whole page), then write the page again."
  );
}

/**
 * The `before`/`after` pair off a `pages_move_region` input — exactly one, as a placement.
 *
 * @throws {ToolInputError} When neither or both were sent.
 * @complexity O(1).
 */
export function parseMovePlacement(input: Record<string, unknown>): { placement: "before" | "after"; targetHandle: string } {
  const hasBefore = input.before !== undefined;
  if (hasBefore === (input.after !== undefined)) {
    throw new ToolInputError({ message: "Send exactly one of 'before' or 'after': the handle of the region the moved section should sit immediately before, " +
        "or immediately after. Nothing was written." });
  }
  const placement = hasBefore ? "before" : "after";
  return { placement, targetHandle: requireString({ input: input, key: placement }) };
}

/**
 * The refusal for a move whose target is the moved region itself or lies inside it.
 *
 * @complexity O(1).
 */
export function describeMoveProblem(move: { handle: string; targetHandle: string; placement: string; problem: RegionMoveProblem }): string {
  const { handle, targetHandle, placement, problem } = move;
  if (problem === "self") {
    return `Nothing was written: '${handle}' cannot be placed ${placement} itself. Name a different region as the target.`;
  }
  return (
    `Nothing was written: '${targetHandle}' is inside '${handle}', so '${handle}' cannot be placed ${placement} it — a section ` +
    `cannot sit inside itself. Name a region outside '${handle}' as the target.`
  );
}



/**
 * Writes `html` on the store's captured basis. `basis: null` means this turn just converted a doc
 * Page, which is always a change; otherwise an unchanged normalized write leaves the version alone.
 * @complexity O(n) in the HTML's size (the store write).
 */
export async function writeOnBasis({ store, html, basis }: { store: PagesHtmlDocumentStorePort; html: string; basis: number | null }, _optional = {}): Promise<PageHtmlWriteOutcome<null>> {
  await store.write({ html });
  const version = requireCapturedVersion(store);
  return { changed: basis === null || version !== basis, version, value: null };
}

/**
 * Records one assistant HTML operation through {@link recordAssistantPageHtmlWrite}, scoped to this
 * handler's workspace, the resolved page id and the calling principal.
 * @complexity O(1) besides `write`.
 */
export function recordPageWrite<T, D extends PagesToolDeps>(
  { routeDeps, ctx, id, expectedVersion, operation, write, host }: {
    host: Parameters<typeof buildPagesRegistrations<D>>[0]["host"];
    routeDeps: D; ctx: Parameters<ToolHandler>[0]; id: string; expectedVersion: number; operation: PageHtmlOperation; write: () => Promise<PageHtmlWriteOutcome<T>>;
  },
  _optional = {},
) {
  return host.recordWrite({ deps: routeDeps })({
    target: { workspaceId: routeDeps.workspaceId, pageId: id, actorId: ctx.principal.id, executionId: ctx.executionId },
    expectedVersion, operation, write, signal: ctx.signal,
  });
}

/** Only a committed record earns an Undo claim: no id, no recorded Undo. */
export function undoField({ changeSetId }: { changeSetId: string | undefined }, _optional = {}): { changeSetId?: string } {
  return changeSetId === undefined ? {} : { changeSetId };
}

/**
 * Normalize the page-region target before canonical validation without changing its DOM handle.
 * Keep legacy spellings for at least 90 days from release; reject dual spellings even when equal
 * so callers cannot depend on silent precedence. Other fields and caller input stay untouched.
 * @returns Canonical input and value-free alias notes.
 * @throws {ToolInputError} When more than one target spelling is present.
 * @complexity O(n) time and space for copying n input fields; three fixed selector checks, no I/O.
 */
function normalizePageRegionInput(
  { input }: { input: Record<string, unknown> },
  _options: Record<string, never> = {},
) {
  const selectors = ["regionId", "handle", "region"].filter((key) => Object.hasOwn(input, key));
  if (selectors.length > 1) {
    throw new ToolInputError({ message: "regionId, handle and region name the same target. Send only regionId." });
  }
  const [selector] = selectors;
  if (!selector || selector === "regionId") return { input, notes: [] };
  const { [selector]: regionId, ...rest } = input;
  return { input: { ...rest, regionId }, notes: [`${selector}→regionId`] };
}

/** Shared assistant target inputs own slug lookup after site selection and authorization.
 * Region aliases remain owned by Pages.
 * @returns Canonical input and value-free alias notes.
 * @throws ToolInputError for competing region selectors or a missing write-region target.
 * @complexity O(k) time/space in supplied keys for region aliases; otherwise O(1), no I/O.
 */
export function normalizePageInput({ input, toolId }: { input: Record<string, unknown>; toolId: string }, _options = {}) {
  if (!["pages_read_html", "pages_write_region", "pages_move_region"].includes(toolId)) return { input, notes: [] };
  const normalized = normalizePageRegionInput({ input });
  // ccdc7e888 moved slug lookup ahead of the handler. Reject a missing region before any lookup,
  // after accepting the existing aliases; the read tool still permits the whole document.
  if (toolId === "pages_write_region") requireString({ input: normalized.input, key: "regionId" });
  return normalized;
}

/** Store-owned diagnostics share the existing assistant warning projection. */
export function embedWarningMessages({ store }: { store: PagesHtmlDocumentStorePort }, _options = {}): readonly string[] {
  return (store.embedWarnings?.() ?? []).map(warning => warning.message);
}


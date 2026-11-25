/**
 * @file The page editor's save plumbing: writing the row then its HTML body, applying a full or
 * partial success, and turning a failed save into the editor's message. A verbatim move out of
 * `use-page-editor.hooks.ts` (its size ratchet), no behavior change.
 */

import type { PageEditorPort } from "@jini-ai/core/contracts/site/content-editor-ports";

export interface PageSavePlan {
  canSaveHtml: boolean;
  statusToWrite: "draft" | "published";
  updatePostPayload: {
    title: string;
    slug: string;
    status: "draft" | "published";
    templateChoice: string | null;
    bodyJson?: Record<string, unknown>;
    /** The optimistic-concurrency basis — the `version` this editor loaded, NOT a writable field.
     *  The server compares it and answers `409 VERSION_CONFLICT` when a newer save has superseded
     *  it. See {@link buildPageSavePlan} for why this write, not the HTML one, carries it. */
    expectedVersion: number;
  };
}

/** `save`'s own "apply a successful write" step, named out of `save`'s body for the same
 *  complexity-ceiling reason {@link computeContentDirty} above documents (2026-09-05
 *  stale-settlement sweep: adding the generation guard pushed `save` over the gate). Called only
 *  once `save` has confirmed this call's generation is still current — see `save`'s own
 *  `settlement` doc — so every branch here runs unconditionally once reached. */
export function applySavedPage<Row extends { slug: string; status: "draft" | "published"; version: number }>(
  { updated, form, canSaveHtml, setters, t, locale, pageUnchangedSaveMessage, pageSaveSuccessMessage }: {
    updated: Row;
    form: { templateChoice: string | null; html: string; nextStatus?: "draft" | "published"; basisVersion: number };
    canSaveHtml: boolean;
    pageUnchangedSaveMessage: (required: { t: (required: { locale: string; key: string }) => string; locale: string; version: number }) => string;
    pageSaveSuccessMessage: (required: { t: (required: { locale: string; key: string }) => string; locale: string; canSaveHtml: boolean }) => string;
    setters: {
      setPage: (page: Row) => void;
      setSlug: (slug: string) => void;
      setStatus: (status: "draft" | "published") => void;
      setSavedTemplateChoice: (value: string | null) => void;
      setSavedHtml: (value: string) => void;
      setMessage: (value: string) => void;
    };
    t: (required: { locale: string; key: string }) => string;
    locale: string;
  },
  _options = {},
): void {
  setters.setPage(updated);
  setters.setSlug(updated.slug);
  setters.setStatus(updated.status);
  setters.setSavedTemplateChoice(form.templateChoice);
  if (canSaveHtml) setters.setSavedHtml(form.html);
  if (form.nextStatus) setters.setStatus(form.nextStatus);
  // The server skips a save whose content matches what's stored and answers with the SAME version
  // (2026-10-10, no-op save guard), so an unchanged version means nothing new was written.
  const unchanged = form.nextStatus === undefined && updated.version === form.basisVersion;
  setters.setMessage(unchanged ? pageUnchangedSaveMessage({ t, locale, version: updated.version }) : pageSaveSuccessMessage({ t, locale, canSaveHtml }));
}

/**
 * The two writes a Page save makes, in the order that makes the version guard real.
 *
 * Metadata first, body second: metadata checks the version this editor loaded, then the HTML
 * request carries the version that successful metadata save returned. A save between those requests
 * is refused by the HTML store instead of overwriting the other editor's body.
 *
 * @returns The final stored row: the body write's response when it fired, the metadata write's
 *   otherwise. Reading the earlier one would hand the caller a `version` already one behind.
 * @complexity Time O(1) plus one or two requests; space O(1).
 */
export async function writePage<Row extends { slug: string; status: "draft" | "published"; version: number }>({ port, pageId, plan, html }: { port: Pick<PageEditorPort<Row, never, never, never>, "updatePost" | "updatePageHtml">; pageId: string; plan: PageSavePlan; html: string }, _options = {}
): Promise<Row> {
  const { post: updated } = await port.updatePost({ target: { id: pageId }, patch: plan.updatePostPayload });
  if (!plan.canSaveHtml) return updated;
  try {
    const { post: withBody } = await port.updatePageHtml({ id: pageId, html, expectedVersion: updated.version });
    return withBody;
  } catch (e) {
    // The metadata write above already landed — losing that fact here is exactly the partial-success
    // bug this wraps against (H1, 2026-09-20). See `PageBodyWriteError`'s own doc and
    // `applySaveFailure`'s handling of it.
    throw new PageBodyWriteError({ savedRow: updated, reason: e });
  }
}

/** Thrown by {@link writePage} when the metadata write landed but the body write then failed. Carries
 *  `savedRow` — the metadata write's own response, the only successful outcome to have happened by
 *  the time this is thrown — so `applySaveFailure` can apply it without a second round-trip, and
 *  `reason`, whatever the body write itself threw, for the message shown to the operator. */
export class PageBodyWriteError<Row extends { slug: string; status: "draft" | "published"; version: number }> extends Error {
  readonly savedRow: Row;
  readonly reason: unknown;

  constructor({ savedRow, reason }: { savedRow: Row; reason: unknown }, _options = {}) {
    super("page body write failed after its metadata write already landed");
    this.savedRow = savedRow;
    this.reason = reason;
  }
}

/** `applySaveFailure`'s own "apply what already succeeded" step for a {@link PageBodyWriteError} —
 *  the metadata write's response, applied EXCEPT `setSavedHtml`, so the body stays dirty and the next
 *  Save (or the operator noticing the banner) retries writing it rather than the editor quietly
 *  treating an unsaved body as saved. Deliberately narrower than {@link applySavedPage}: no
 *  `setMessage` (the caller shows the partial-failure text instead, via `pagePartialSaveMessage`) and
 *  no `nextStatus` override (the metadata write already wrote whatever status this attempt asked
 *  for, since it is what succeeded). */
export function applyPartialSave<Row extends { slug: string; status: "draft" | "published"; version: number }>(
  { updated, form, setters }: {
    updated: Row;
    form: { templateChoice: string | null };
    setters: {
      setPage: (page: Row) => void;
      setSlug: (slug: string) => void;
      setStatus: (status: "draft" | "published") => void;
      setSavedTemplateChoice: (value: string | null) => void;
    };
  },
  _options = {},
): void {
  setters.setPage(updated);
  setters.setSlug(updated.slug);
  setters.setStatus(updated.status);
  setters.setSavedTemplateChoice(form.templateChoice);
}

/** `runSave`'s own catch arm, named out of its body for the same complexity-ceiling reason
 *  {@link applySavedPage} above documents.
 *
 *  A {@link PageBodyWriteError} is handled FIRST and separately from the version conflict below: it
 *  is not a rejected save at all but a partial one, so it gets `applyPartialSave` plus
 *  `pagePartialSaveMessage` rather than either the conflict banner or the generic error line — see
 *  H1's own writeup (`ADS-memory/.local-artifacts/terra-admin-review-2026-09-20/plan-content.md`).
 *
 *  The version conflict is NOT folded into the generic error line either. The two need opposite
 *  reactions from the operator (a slug collision or a network blip: fix it and press Save again;
 *  this: pressing Save again replaces somebody's page), and the whole point of the route's distinct
 *  `code` is that the client no longer has to guess which it got — see `readVersionConflict`. */
export function applySaveFailure<Row extends { slug: string; status: "draft" | "published"; version: number }, Conflict>(
  { e, attemptedStatus, form, setters, t, locale, readVersionConflict, isUnexpectedServerFailure, pagePartialSaveMessage }: {
    e: unknown;
    readVersionConflict: (required: { error: unknown; attemptedStatus: "draft" | "published" | undefined }, optional?: Record<string, never>) => Conflict | null;
    isUnexpectedServerFailure: (required: { error: unknown }, optional?: Record<string, never>) => boolean;
    pagePartialSaveMessage: (required: { t: (required: { locale: string; key: string }) => string; locale: string; reason: unknown }) => string;
    attemptedStatus: "draft" | "published" | undefined;
    form: { templateChoice: string | null };
    setters: {
      setPage: (page: Row) => void;
      setSlug: (slug: string) => void;
      setStatus: (status: "draft" | "published") => void;
      setSavedTemplateChoice: (value: string | null) => void;
      setSaveConflict: (value: Conflict) => void;
      setError: (value: string) => void;
    };
    t: (required: { locale: string; key: string }) => string;
    locale: string;
  },
  _options = {},
): void {
  if (e instanceof PageBodyWriteError) {
    applyPartialSave({ updated: (e as PageBodyWriteError<Row>).savedRow, form, setters });
    setters.setError(pagePartialSaveMessage({ t, locale, reason: e.reason }));
    return;
  }
  const conflict = readVersionConflict({ error: e, attemptedStatus }, {});
  if (conflict) {
    setters.setSaveConflict(conflict);
    return;
  }
  // A server or network failure already raised the shared failure notice (plain words, copyable details); repeating its raw message here would show it twice.
  if (isUnexpectedServerFailure({ error: e }, {})) { setters.setError(t({ locale, key: "Not saved. Your edits are still here." })); return; }
  setters.setError(e instanceof Error ? e.message : refusalMessage({ base: t({ locale, key: "failed to save page" }), e }));
}

/** The fallback sentence plus the real content of a thrown non-Error, so the person (and whoever they paste it to) sees why. With nothing thrown there is nothing to add. @complexity O(size of e), capped at 300 characters. */
function refusalMessage({ base, e }: { base: string; e: unknown }): string {
  if (e === undefined || e === null) return base;
  let text: string;
  try { text = typeof e === "string" ? e : JSON.stringify(e) ?? String(e); } catch { text = String(e); }
  return `${base}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
}

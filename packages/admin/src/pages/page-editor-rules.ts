import type { StandingDraftAutosaveInput } from "../react/kit.js";

import type { Translate } from "@jini-ai/core/text";

/**
 * @file Pure logic for the admin Page EDITOR — everything the editor computes rather than renders:
 * the save plan, the autosave draft, the template-picker sentinel, the save/conflict/stale-basis
 * messages, the preview sandbox flags and the dirty-guard baseline. Split out of the host's shared
 * pages `rules.ts`, which keeps the link rules (admin/public path, content-refresh resource), the
 * theme-backed rules (template picker value, editor surface, Theme Page row menu) and its
 * version-conflict aliases.
 *
 * Product- and theme-neutral: the loaded page row, the stale-basis notice and the conflict are read
 * through the narrow structural views below, so a host's own records satisfy them with no cast.
 */

/** Which tab the page editor's main pane is on. */
export type PageEditorView = "preview" | "html" | "interactive";

/** The slice of a host's loaded page record these rules read — structural, so the host's own row type
 *  (with every other field it carries) is assignable with no cast. */
export interface PageEditorRecord {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  bodyFormat?: "doc" | "html";
  bodyHtml?: string | null;
}

/** The slice of a refused autosave {@link pageAutosaveStaleBasisMessage} reads. */
export interface PageAutosaveStaleBasis {
  baseVersion: number;
}

/** The slice of a rejected save {@link pageVersionConflictMessage} reads. `null` only if the server
 *  omitted that version. */
export interface PageVersionConflictBasis {
  expectedVersion: number | null;
  currentVersion: number | null;
}

/** What `usePageEditor`'s `save` sends to the two write routes, and whether the HTML route applies
 *  at all — see `use-page-editor.hooks.ts`'s own `save` for the full "why two routes" reasoning, and
 *  {@link pageAcceptsHtmlBody} for exactly when `updatePageHtml` is allowed to fire (`updatePost`
 *  needs a round-tripped `bodyJson` for every Page still in doc format when metadata is written,
 *  including a new Page about to be converted by the subsequent HTML write). */
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

/** The subset of a loaded `AdminPost` {@link pageAcceptsHtmlBody} actually reads — kept narrow
 *  rather than importing the full `AdminPost` type, so a test can pass a bare literal. Field types
 *  mirror `AdminPost`'s own exactly (`bodyFormat` optional, `bodyJson` a plain record) so a real
 *  `AdminPost` is always assignable here without a cast. */
export interface SavablePage {
  bodyFormat?: "doc" | "html";
  bodyJson: Record<string, unknown>;
}

/** {@link SavablePage} plus the row's `version` — the optimistic-concurrency basis both
 *  {@link buildPageSavePlan} and {@link buildPageAutosaveDraft} capture. Separate from
 *  {@link SavablePage} because {@link pageAcceptsHtmlBody} genuinely does not need it and should
 *  not force a caller to supply one. */
export interface VersionedSavablePage extends SavablePage {
  version: number;
}

/** Whether `bodyJson` holds an actual authored Tiptap document, as opposed to the empty
 *  `DEFAULT_BODY_JSON` (`{ type: "doc", content: [] }`) every `createPost` row is born with
 *  (the host's post store). Deliberately conservative: ANY non-empty `content`
 *  array counts as real content, including a single empty paragraph, because the only thing this
 *  answer gates is whether we are willing to DESTROY that document — and the cost of being wrong in
 *  the cautious direction is a refusal the operator is told about, while the cost of being wrong in
 *  the other direction is silent data loss. An absent/non-array `content` is treated as empty: it is
 *  not a document this editor could lose anything from. */
function hasAuthoredDocument(bodyJson: Record<string, unknown>): boolean {
  const content = bodyJson.content;
  return Array.isArray(content) && content.length > 0;
}

/** Sentinel written into the template `<select>`'s `value` when `templateChoice` is `null` and the
 *  active theme ships neither canonical page-shell filename — see {@link pagePickerValue}'s own doc.
 *  Never a real theme filename (those are always `*.html`), so it can never collide with an
 *  operator's own pick. */
export const THEME_DEFAULT_SENTINEL = "__theme-default__";

/**
 * The inverse of {@link pagePickerValue} — what to write as `templateChoice` when the operator picks
 * `value` in the `<select>`. Only {@link THEME_DEFAULT_SENTINEL} needs translating back to `null`;
 * every other value (a real filename, or `""`) is already the exact `templateChoice` to store.
 * Picking the shell filename directly (rather than the sentinel) stores that real filename, which
 * renders identically to `null` — a deliberate, disclosed no-op, not a bug.
 *
 * @complexity O(1).
 */
export function pickerValueToChoice({ value }: { value: string }, _options = {}): string | null {
  return value === THEME_DEFAULT_SENTINEL ? null : value;
}

/**
 * Whether this editor's HTML working copy is a body it may actually write — the single predicate
 * behind `save`'s `updatePageHtml` call, `contentDirty`'s body comparison, and the standing-draft
 * autosave's format, so those three cannot disagree about what the operator is editing.
 *
 * **An already-`html` Page: always.** That is the original, unchanged rule.
 *
 * **A `doc`-format Page: only when the operator authored non-empty HTML into a Page that has no
 * Tiptap document to lose.** This is the 2026-09-06 fix for "the Pages editor cannot write HTML into
 * a newly created page": `New Page` (`use-pages.hooks.ts`'s `createPage`) goes through `createPost`,
 * which forces `bodyFormat: "doc"` by construction (ADR-056 CIC-3 — `CreatePostInput` has no
 * `bodyFormat` field at all), while `PageEditor.tsx` offers that page an HTML textarea and a GrapesJS
 * canvas regardless of format. A flat `bodyFormat === "html"` test therefore made every keystroke of
 * hand-authored markup unsavable through the product, which is why operators had to bypass the
 * editor and `PUT /pages/:id/html` by hand.
 *
 * **The two guards are what keep the F01 data-loss fix intact** (see `use-page-editor.unit.test.ts`'s
 * own file header): `updatePageHtml`'s first call on a doc-format row converts it and DROPS
 * `body_json` (the host's page-HTML write route). `html !== ""` means an ordinary Save or Publish
 * that never touched the body still takes the metadata-only path — the editor loads `html` as `""`
 * for a doc-format Page, so an empty working copy is "nothing was authored", never "the operator
 * cleared it". {@link hasAuthoredDocument} means a legacy Page with a real Tiptap body is never
 * converted at all, even if markup IS typed over it; that operator gets
 * {@link pageSaveSuccessMessage}'s "can't be edited here yet" refusal instead of a blanked page.
 *
 * @complexity Time O(1), space O(1) — one property read and one length check.
 */
export function pageAcceptsHtmlBody({ page, html }: { page: SavablePage; html: string }, _options = {}): boolean {
  if (page.bodyFormat === "html") return true;
  return html !== "" && !hasAuthoredDocument(page.bodyJson);
}

/**
 * `save`'s own decision, pulled out to a top-level pure function per the 2026-08-12
 * complexity-ceiling pass: what to send `updatePost`, and whether `updatePageHtml` fires at all.
 * `save` itself keeps only the two `await`s, the `setState` calls, and the try/catch/finally — the
 * genuinely effectful part that has to stay.
 *
 * `form.html` is the working copy, not the saved body: {@link pageAcceptsHtmlBody} needs it to tell
 * "the operator authored markup into a brand-new page" apart from "an ordinary metadata save on a
 * page whose body this editor cannot render" — see that function's own doc.
 *
 * @complexity Time/space: O(1).
 */
export function buildPageSavePlan(
  { page, form }: {
    page: VersionedSavablePage;
    form: { title: string; slug: string; status: "draft" | "published"; templateChoice: string | null; html: string };
  },
  { nextStatus }: { nextStatus?: "draft" | "published" | undefined } = {},
): PageSavePlan {
  const canSaveHtml = pageAcceptsHtmlBody({ page, html: form.html });
  const statusToWrite = nextStatus ?? form.status;
  return {
    canSaveHtml,
    statusToWrite,
    updatePostPayload: {
      title: form.title,
      slug: form.slug,
      status: statusToWrite,
      templateChoice: form.templateChoice,
      // The basis `save` guards the WHOLE save on. `updatePost` is the only one of the two write
      // routes that offers compare-and-set against a client-supplied version: `PUT /pages/:id/html`
      // reads the row and writes it back inside one request (the host's page-HTML write route),
      // so the version it conditions on is one it captured microseconds earlier and can never be
      // the version THIS editor loaded. That is why `save` now writes metadata first and only
      // reaches the body once this guard has passed — see `save`'s own doc.
      expectedVersion: page.version,
      // Metadata is written BEFORE conversion. The server still validates bodyJson
      // against the loaded doc format even when the following HTML write will replace it.
      ...(page.bodyFormat === "html" ? {} : { bodyJson: page.bodyJson }),
    },
  };
}

/**
 * What to send `putAutosave` for the CURRENT working copy — same {@link pageAcceptsHtmlBody} split
 * a real Save makes, so a parked draft can never be a format the Save that follows it would refuse.
 * A Page whose body this editor cannot write round-trips `bodyJson` unchanged instead — the same
 * inert-but-required placeholder that Save already sends for that case.
 *
 * @complexity Time/space: O(1).
 */
export function buildPageAutosaveDraft(
  { page, form }: { page: VersionedSavablePage; form: { title: string; slug: string; html: string } }, _optional: Record<string, never> = {},
): StandingDraftAutosaveInput {
  if (pageAcceptsHtmlBody({ page, html: form.html })) {
    return { bodyFormat: "html", bodyHtml: form.html, title: form.title, slug: form.slug, baseVersion: page.version };
  }
  return { bodyFormat: "doc", bodyJson: page.bodyJson, title: form.title, slug: form.slug, baseVersion: page.version };
}

/**
 * The stale-basis notice's own message — the BACKGROUND-autosave counterpart of the recovery
 * banner's shared `standingDraftRecoveryMessage`, and the reason `staleBasis` exists on
 * the shared autosave hook at all. Kept feature-local and character-identical to
 * `features/posts/rules.ts`'s `postAutosaveStaleBasisMessage`, respecting the no-cross-feature-import
 * boundary (`lib/` hosts the shared pieces).
 *
 * Says the four things an operator cannot infer from a screen that otherwise looks completely
 * normal: that someone else saved, that autosaving has consequently STOPPED (a running editor that
 * silently persists nothing is the entire defect), that their work is unsaved but still in front of
 * them, and what actually resumes autosaving.
 *
 * Deliberately does NOT promise that the text is recoverable after a reload. The hook does mirror a
 * refused draft into browser storage (`lib/standing-draft-local-backup.ts`), but that mirror is
 * best-effort — `localStorage` throws outright in some privacy modes — and it is offered back only
 * when the server has nothing of its own parked for the entry. "Copy anything you want to keep
 * first" is advice that is never wrong; a promise of recovery would be one this code cannot keep.
 *
 * @complexity Time/space: O(1).
 */
export function pageAutosaveStaleBasisMessage({ t, ...staleBasis }: { t: Translate } & PageAutosaveStaleBasis, _optional: Record<string, never> = {}): string {
  return t(
    "Someone else saved this while you were editing — you were working from version {baseVersion}, so autosaving has paused and nothing you type now is being stored. Your changes were NOT saved, and are still here in the editor. Reload to pick up their version and resume autosaving; copy anything you want to keep first."
  ).replace("{baseVersion}", String(staleBasis.baseVersion));
}

/**
 * The conflict banner's own message. NOT run through `t()`, for the same reason
 * {@link pageAutosaveStaleBasisMessage} just above is not — it interpolates two runtime values.
 *
 * States the two things an operator has to know and cannot infer: that their work was NOT saved but
 * is still in front of them, and that saving again overwrites the other person rather than merging.
 * Deliberately does not promise a merge, a diff, or a way to see what changed — none of those exist
 * here, and the recovery this screen genuinely offers is "your text is still in the editor".
 *
 * @complexity Time/space: O(1).
 */
export function pageVersionConflictMessage({ t, ...conflict }: { t: Translate } & PageVersionConflictBasis, _optional: Record<string, never> = {}): string {
  const basis =
    conflict.expectedVersion === null ? t("the version you loaded") : t("version {version}").replace("{version}", String(conflict.expectedVersion));
  const current =
    conflict.currentVersion === null ? t("a newer version") : t("version {version}").replace("{version}", String(conflict.currentVersion));
  return t(
    "Someone else saved this while you were editing — you were working from {basis}, and {current} is now stored. Your changes were NOT saved, and are still here in the editor."
  )
    .replace("{basis}", () => basis)
    .replace("{current}", () => current);
}

/** The save-success message — the one piece of copy in `save` that depends on `canSaveHtml`, split
 *  out alongside {@link buildPageSavePlan} for the same reason. `t`/`locale` are threaded through
 *  rather than imported, matching every other pure function in this module. */
export function pageSaveSuccessMessage({ t, locale, canSaveHtml }: { t: (required: { locale: string; key: string }) => string; locale: string; canSaveHtml: boolean }, _options = {}): string {
  return canSaveHtml
    ? t({ locale, key: "Saved" })
    : t({ locale, key: "Saved title, slug, and status. This page's body uses the document editor and can't be edited here yet." });
}

/** The message when a Save came back with the version it was based on — the server found nothing
 *  different and wrote nothing (no-op save guard, 2026-10-10). Same copy as the Posts editor's. */
export function pageUnchangedSaveMessage({ t, locale, version }: { t: (required: { locale: string; key: string }) => string; locale: string; version: number }, _options = {}): string {
  return t({ locale, key: "No changes found · nothing new saved (version {version})" }).replace("{version}", String(version));
}

/** The exact English copy {@link pagePartialSaveMessage} wraps in `t()` — also the dictionary key
 *  added to `page-editor-i18n.ts`'s `PAGE_EDITOR_DICT` for every locale, matching this app's "the key
 *  IS the source string" convention. Kept as a separate constant (rather than inlined in the template
 *  literal below) so the two stay textually identical by construction. */
const PAGE_PARTIAL_SAVE_COPY =
  "Title, slug and status saved, but the page content wasn't. Your content is still here — press Save to retry.";

/**
 * The banner `usePageEditor` shows when a Page's metadata write landed but its body write then
 * failed (H1, 2026-09-20) — see `use-page-editor.hooks.ts`'s `PageBodyWriteError` and `writePage` for
 * why the two writes can now part ways instead of one opaque failure. Appends the underlying reason
 * in parentheses, the same "state what happened, then why" shape {@link pageVersionConflictMessage}
 * already uses, falling back to the generic "failed to save page" copy for a non-`Error` rejection —
 * the same fallback `applySaveFailure`'s own generic branch already uses for that case.
 *
 * @complexity Time/space: O(1).
 */
export function pagePartialSaveMessage({ t, locale, reason }: { t: (required: { locale: string; key: string }) => string; locale: string; reason: unknown }, _options = {}): string {
  const why = reason instanceof Error && reason.message ? reason.message : t({ locale, key: "failed to save page" });
  return `${t({ locale, key: PAGE_PARTIAL_SAVE_COPY })} (${why})`;
}

/** The pending-html preview form's `target` — see `PageEditorController.previewFormRef`. `""` before
 *  `page` loads, since `PagePreview` never renders that early. Split out of `usePageEditor` under the
 *  complexity ceiling. */
export function pagePreviewFormTarget({ page }: { page: Pick<PageEditorRecord, "id"> | null }, _options = {}): string {
  return page ? `page-preview-pending-${page.id}` : "";
}

/**
 * The `sandbox` flags on BOTH `PagePreviewFrame` iframes (live site and template preview), 2026-10-04.
 * Before this the preview iframes had no `sandbox` at all, while `update-html.ts`'s header claimed the
 * authoring preview was sandboxed. The post editor's three `PostPreviewFrame` iframes
 * (`features/posts/PostEditor.tsx`) import this same constant (owner, 2026-10-04) so the two editors'
 * flags cannot drift.
 *
 * Each flag is there because the preview needs it to render and behave as it does unsandboxed:
 * - `allow-scripts`: theme JS (menus, carousels, Liquid-rendered widgets) must run in the preview.
 * - `allow-forms`: shipped themes have real forms (sign-in/sign-up pages, newsletter footers).
 * - `allow-popups`: authored HTML uses `target="_blank"` links; a popup inherits this sandbox (no
 *   `allow-popups-to-escape-sandbox`).
 *
 * Deliberately absent: `allow-top-navigation` (and its user-activation variant), so the preview can
 * never navigate the admin tab itself by `target="_top"` links or `top.location`, and `allow-modals`.
 * Link clicks inside the frame still navigate the frame, which needs no flag.
 *
 * Deliberately absent since 2026-10-05: `allow-same-origin`. Both branches load the template-preview
 * route from the admin's own origin (the saved-content branch too since 2026-10-31: an opaque origin
 * cannot store a cookie-consent choice, and that route renders without the consent gate), and a same-origin document holding `allow-scripts allow-same-origin`
 * can reach `parent.document`, call `/api/admin/*` with the owner's session, and strip its own sandbox.
 * Without it the preview runs in an opaque origin, the same isolation Theme Studio's preview already
 * uses. What that costs, accepted on purpose:
 * - per-tab scroll memory (`onPreviewFrameLoad` can no longer read or set `contentWindow.scrollY`; its
 *   `try` swallows the `SecurityError`, so the preview opens at the top),
 * - Escape inside an expanded post preview (`usePostPreviewIframeEscape` gets a null
 *   `contentDocument`; the visible exit control still collapses it),
 * - theme scripts that touch `localStorage`/cookies, or call the site's own APIs, inside the preview.
 * Theme fonts still load: `/theme-assets` answers font requests with `Access-Control-Allow-Origin: *`
 * for exactly this opaque-origin case (`theme-content-security-headers.ts`).
 */
export const PAGE_PREVIEW_IFRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

/**
 * The working copy's editable HTML for a loaded row — exactly the mount effect's own
 * `post.bodyFormat === "html" ? (post.bodyHtml ?? "") : ""` rule, lifted out so
 * `applyExternalPage` (an assistant write landing while the editor is open) can seed the SAME
 * initial value the mount effect does, rather than duplicating the ternary at a second call site.
 * A doc-format row has no editable HTML here — see `pageAcceptsHtmlBody`'s own doc for why this
 * editor cannot render that body at all.
 *
 * @complexity O(1).
 */
export function pageEditableHtml(post: Pick<PageEditorRecord, "bodyFormat" | "bodyHtml">, _optional: Record<string, never> = {}): string {
  return post.bodyFormat === "html" ? (post.bodyHtml ?? "") : "";
}

/**
 * Whether a background refresh must treat the working copy as possibly holding unsaved edits — the
 * `isDirty` `usePageEditor` hands `useExternalEntryRefresh`, deliberately wider than the Save
 * button's own `dirty`.
 *
 * The Interactive tab is always "maybe": GrapesJS keeps typed text in its canvas and writes it to
 * `html` only when the operator leaves that text element (its `update` event is deferred too), so
 * `dirty` can read false while unsaved typing is on screen. A silent apply there remounts the canvas
 * and destroys that text — reproduced in a real browser 2026-09-16. On that tab the refresh shows the
 * Load latest / Keep my edits notice instead. The Preview and HTML tabs write every keystroke
 * straight to `html`, so `dirty` is exact there.
 *
 * @complexity O(1).
 */
export function pageRefreshMayHaveUnsavedEdits(input: { dirty: boolean; view: PageEditorView }): boolean {
  return input.dirty || input.view === "interactive";
}

/** The external-change notice's own message — plain English, not run through `t()`, matching
 *  {@link pageVersionConflictMessage} and {@link pageAutosaveStaleBasisMessage} just above:
 *  `PageEditor.tsx`'s markup is outside the pages dictionary's declared scope (`pages-i18n.ts`'s own
 *  header). Shown when a newer version lands while the editor has unsaved edits — see
 *  `use-external-entry-refresh.hooks.ts` for the clean/dirty decision this banner is the dirty half
 *  of. */
export const PAGE_EXTERNAL_CHANGE_MESSAGE =
  "Changed outside the editor, probably by the assistant. Loading the latest version discards your unsaved edits.";

/** The Page editor's `useDirtyGuard` baseline: the loaded row's title/slug/status plus the saved html
 *  and template choice. `null` before `page` loads, which the guard reads as "nothing is dirty yet".
 *  Split out of `usePageEditor` under the complexity ceiling. */
export function pageDirtyGuardBaseline({ page, savedHtml, savedTemplateChoice }: { page: Pick<PageEditorRecord, "title" | "slug" | "status"> | null; savedHtml: string; savedTemplateChoice: string | null }, _options = {}
): { title: string; slug: string; status: PageEditorRecord["status"]; html: string; templateChoice: string | null } | null {
  if (!page) return null;
  return { title: page.title, slug: page.slug, status: page.status, html: savedHtml, templateChoice: savedTemplateChoice };
}

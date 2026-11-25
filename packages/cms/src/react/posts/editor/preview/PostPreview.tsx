import type { ComponentType, ReactNode } from "react";
import { PostPreviewFrame } from "./PostPreviewFrame.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";

/**
 * Renders the post the way the Preview tab shows it — mirrors `features/pages/PageEditor.tsx`'s
 * `PagePreview` for branches 1 and 2 (see that function's own doc for the full explanation;
 * `ADS-memory/reports/implementation/2026-08-11-html-view-and-preview.md` has the original decision
 * record this repeats, and `2026-08-11-template-preview-render-bug.md` has the template-preview fix
 * below). Three branches, evaluated in this order:
 *
 * 1. **Saved content** (`status === "published" && !dirty`): GETs the authenticated preview URL.
 *    The shared renderer keeps theme CSS/nav/footer/widgets; consent is excluded because the
 *    opaque-origin sandbox cannot save a choice.
 * 2. **Template preview** (2026-08-11 fix) (`status === "published" && !contentDirty`, i.e.
 *    title/slug/status/body/`overridesThemePage` all match what's saved and the post IS published —
 *    only `templateChoice` is pending): `GET`s `templatePreviewUrl` — `usePostEditor`'s pre-built URL
 *    (`port.templatePreviewUrl`, `post-editor-port.hooks.ts`; the real binding calls `lib/api.ts`'s
 *    own `templatePreviewUrl`), the SAME real render pipeline as branch 1, looked up by id instead of
 *    by public slug.
 * 3. **Pending-content preview** (2026-08-12 fix — the owner's own reported bug: formatting text on
 *    an already-published post used to drop the preview straight to a raw, unstyled editor-buffer
 *    fallback the instant `contentDirty` went true, even though the post was still live at its public
 *    URL; widened 2026-09-09 to also cover a DIRTY draft; widened again 2026-09-11 to be the plain
 *    negation of branches 1/2 — see immediately below). Same `template-preview` endpoint as branch 2,
 *    but `POST`ed instead of `GET`ted so the request can carry a BODY: a hidden `<form method="post"
 *    target="{iframe's name}">` submits `bodyJson` — the live, UNSAVED `editor.getJSON()` — into the
 *    targeted iframe, landing a real navigated document instead of a `srcDoc` string. `srcDoc` is
 *    rejected here for the same reason `template-preview.ts`'s own file header gives: the rendered
 *    HTML's asset paths are root-relative to `/theme-assets/{themeId}/...`, which only resolves once
 *    the browser believes it is looking at a real navigated page. Debounced 500ms trailing — a form
 *    submit is a full iframe navigation, not a `fetch`, so firing one per keystroke would be
 *    unusable; the debounce effect itself, and the `formRef`/`previewFormTarget` it needs, now live
 *    in `usePostEditor` (moved 2026-08-14, complexity-ceiling pass — see
 *    `PostEditorController.previewFormRef`'s own doc), so this component only attaches them to the
 *    `<form>`/`<iframe>` pair below.
 *
 *    No longer gated on `status === "published"` (2026-09-09): `template-preview.ts`'s
 *    `pendingBodyJson` override (`resolveHtmlPageEmbeds`'s `pendingContentOverride`) is checked
 *    BEFORE `findPublishedPostById`'s visibility guard, so it already bypassed that guard for a
 *    DRAFT's own id too — the `status === "published"` check here was never load-bearing for
 *    correctness, only inherited from branch 2's (which genuinely does need it, for the
 *    un-overridden `GET` case). Confirmed by a direct backend test before relying on it
 *    (`admin-post-template-preview.test.ts`'s "a DRAFT doc-format post's own body renders via a
 *    POSTed bodyJson override" case) rather than assumed.
 *
 *    No longer gated on `contentDirty` either (2026-09-11, owner-reported: "the preview should always
 *    show the css and template and all that properly" — a CLEAN draft, which is what an operator sees
 *    the instant they open a brand-new post, previously matched none of branches 1/2/3 and fell
 *    through to a fourth branch that rendered `editor.getHTML()` — TipTap's own client-side
 *    serializer, not the server's `renderDocNode` — into a sandboxed `SrcDocSandbox` iframe with no
 *    theme CSS, no nav/footer, and no media resolution at all; autosave clears `contentDirty` within
 *    moments of any edit, so in practice a post spent almost its entire draft lifetime on that raw
 *    branch). `canShowPendingContentPreview` is now simply "neither of the two branches above" —
 *    `!canShowLiveSite && !canShowTemplatePreview` — which makes it the exhaustive fallback for
 *    everything branches 1/2 don't cover, not just the `contentDirty` subset of that. This is the
 *    exact same retirement `features/pages/PageEditor.tsx`'s `PagePreview` already did to its own
 *    third (raw-fallback) branch on 2026-09-09 — see that function's own doc, "That is what retired
 *    the THIRD branch this function used to have" — applied here one branch later, since Posts kept
 *    the GET/POST split (branch 2 vs. 3) Pages collapsed into one. The POST body is still whatever
 *    `bodyJson` is at the moment (`null` before TipTap mounts): `template-preview.ts`'s
 *    `extractPendingBodyJson` already degrades a non-object/unparseable value to `undefined`, which
 *    falls back to rendering the post's last-SAVED body through the real template — never a crash,
 *    and never worse than the raw fallback it replaces.
 *
 * The raw editor-buffer fallback (`SrcDocSandbox` fed `editor.getHTML()`) is deleted, not left as an
 * unreachable last-resort branch: with branch 3 now the unconditional negation of 1 and 2, nothing
 * can reach it any more for a `"doc"`-format post — same "exhaustive by construction, so the
 * fallback had become dead code, not merely rare — removed rather than left unreachable" reasoning
 * `PagePreview`'s own doc gives for its own equivalent removal. `degradeUnplayableEmbedsForRawPreview`
 * (`rules.ts`) existed only to patch that raw branch's own YouTube-embed bug and is removed alongside
 * it, along with its now-fully-unused `SrcDocSandbox` import (grep confirms no other admin caller).
 *
 * Device-width scaling (2026-09-22 owner ask): all three branches render inside the shared
 * `DevicePreviewFrame`, at the toolbar's Desktop/Tablet/Mobile width scaled to fit the pane — the
 * same mechanism as `PagePreview`.
 */
export function PostPreview({
  postId,
  bodyJson,
  slug,
  status,
  scheduled,
  dirty,
  contentDirty,
  templatePreviewUrl,
  previewFormRef,
  previewFormTarget,
  t,
  width,
  expanded,
  onToggleExpanded,
  DevicePreviewFrame, usePreviewPaneWidthHook, resolvePostPreviewBranches, sandbox, usePostPreviewIframeEscapeHook, useThemePreviewFrameHook,
}: {
  /** Empty until first Save; server previews require a persisted post. */
  postId: string;
  /** Loosely typed like `PostFormState.bodyJson` (`use-post-editor.hooks.ts`) for the same stated
   *  reason: this only ever gets `JSON.stringify`'d into a hidden form field below, never read for
   *  its shape. `null` means the editor hasn't mounted yet — see the call site's own comment; a
   *  `null` submits as the literal string `"null"`, which `template-preview.ts`'s
   *  `extractPendingBodyJson` degrades to `undefined` (falls back to the last-saved body), not a
   *  crash — see this function's own doc for why that degrade is an acceptable, deliberate choice. */
  bodyJson: unknown;
  slug: string;
  status: "draft" | "published";
  /** `usePostEditor`'s `scheduled`: a scheduled published post previews like a draft (no live URL yet). */
  scheduled: boolean;
  dirty: boolean;
  contentDirty: boolean;
  /** Pre-built by `usePostEditor` — see this function's own doc, branch 2. Used as both the branch-2
   *  iframe `src` and the branch-3 hidden form's `action` (same endpoint, `GET` vs `POST`). */
  templatePreviewUrl: string;
  /** Owned by `usePostEditor` — see `PostEditorController.previewFormRef`'s own doc for why the
   *  debounced auto-submit effect that reaches through this ref lives there, not here. */
  previewFormRef: (node: HTMLFormElement | null) => void;
  /** The hidden form's `target` and the iframe's `name` it submits into — must match at submit time. */
  previewFormTarget: string;
  /** The selected device's viewport width (`DEVICE_PREVIEW_WIDTHS`) the iframe renders at. */
  width: number;
  /** Preview fullscreen, Level 1 (2026-09-15) — `usePostEditor`'s `previewExpanded`. See
   *  `PostEditorController.previewExpanded`'s own doc for the full lifetime/containment reasoning;
   *  this component only decides what to render given the value. */
  expanded: boolean;
  /** `usePostEditor`'s `togglePreviewExpanded`, bound to the single `.post-preview-fab` control
   *  below, which this component renders in BOTH states. Nothing in `PostEditor`'s own toolbar
   *  toggles this any more (since `a380c716`) — this is the only control that does. */
  onToggleExpanded: () => void;
  t: Translate;
  DevicePreviewFrame: ComponentType<{ width: number; frameRef(node: HTMLDivElement | null): void; paneWidth: number; expanded: boolean; children: ReactNode }>;
  usePreviewPaneWidthHook(): { frameRef(node: HTMLDivElement | null): void; paneWidth: number };
  resolvePostPreviewBranches(required: { status: "draft" | "published"; scheduled?: boolean; dirty: boolean; contentDirty: boolean }): { canShowLiveSite: boolean; canShowTemplatePreview: boolean; canShowPendingContentPreview: boolean };
  sandbox: Parameters<typeof PostPreviewFrame>[0]["sandbox"];
  usePostPreviewIframeEscapeHook: Parameters<typeof PostPreviewFrame>[0]["usePostPreviewIframeEscapeHook"];
  useThemePreviewFrameHook: Parameters<typeof PostPreviewFrame>[0]["useThemePreviewFrameHook"];
}) {
  const { canShowLiveSite, canShowTemplatePreview, frameRef, paneWidth } = usePostPreviewSource({ status, scheduled, dirty, contentDirty, usePreviewPaneWidthHook, resolvePostPreviewBranches });

  // Keep the guard in the preview owner, after hooks so first Save can reveal the server frame.
  if (!postId) return <p className="notice" role="status">{t("Save this post to preview it.")}</p>;

  const pane = (
    <>
      <div className="editor-shell post-editor-pane">
        {/* Keep the note inside the pane: its negative top margin would cover a preceding sibling. */}
        <p className="field-hint editor-preview-note">{t("Cookie banner hidden in preview. Embedded videos may not play here; open the page to check.")}</p>
        <DevicePreviewFrame width={width} frameRef={frameRef} paneWidth={paneWidth} expanded={expanded}>
          <PostPreviewFrame
            canShowLiveSite={canShowLiveSite}
            canShowTemplatePreview={canShowTemplatePreview}
            bodyJson={bodyJson}
            slug={slug}
            templatePreviewUrl={templatePreviewUrl}
            previewFormRef={previewFormRef}
            previewFormTarget={previewFormTarget}
            expanded={expanded}
            onCollapse={onToggleExpanded}
            t={t}
            sandbox={sandbox}
            usePostPreviewIframeEscapeHook={usePostPreviewIframeEscapeHook}
            useThemePreviewFrameHook={useThemePreviewFrameHook}
          />
        </DevicePreviewFrame>
      </div>
    </>
  );

  const fab = <PostPreviewFab expanded={expanded} onToggleExpanded={onToggleExpanded} t={t} />;

  // Collapsed: the pane plus the control, wrapped in `.post-preview-surface` — that wrapper is the
  // `position: relative` ancestor the fab's `position: absolute` resolves against (`editor.css`), so
  // the fab must stay inside it. Same wrapper in the expanded branch below, for the same reason.
  if (!expanded) return <div className="post-preview-surface">{pane}{fab}</div>;

  // Expanded: `.post-preview-expanded` (`styles/editor.css`) is `position: absolute; inset: 0`
  // against `.admin-main-col` — see that rule's own comment for the full containment argument (why
  // this covers only the admin content column, never `.admin-chat-dock`). The same `fab` rides along
  // inside the panel, in the same corner of the same surface, as the always-visible way back out.
  return (
    <div className="post-preview-expanded">
      <div className="post-preview-surface">
        {pane}
        {fab}
      </div>
    </div>
  );
}

// ONE control for both directions, in the same place either way — the way out of the expanded
// panel must always be visible on screen (the earlier overlay attempt died on an operator who
// could not find it). The glyph is `aria-hidden`, so `aria-label` is the ONLY thing telling a
// screen reader or `page.find_elements` which way this goes; keep the two names distinct.
function PostPreviewFab({ expanded, onToggleExpanded, t }: { expanded: boolean; onToggleExpanded: () => void; t: Translate }) {
  return (
    <button
      type="button"
      className="post-preview-fab"
      onClick={onToggleExpanded}
      title={t(expanded ? "Exit full screen (Esc)" : "Show full screen")}
      aria-label={t(expanded ? "Exit full screen" : "Show full screen")}
      {...agentHandle({ handle: "post-preview-expand" }, {
        role: "button",
        // These labels read redundantly ON PURPOSE. `page.find_elements`'s `query` is a plain
        // case-insensitive SUBSTRING match over handle and label — no stemming, no synonyms, no
        // ranking (`@jini-ai/agentic`'s `dom-page-driver.ts`, `findElements`) — so a word that is not
        // literally here retrieves NOTHING, and an assistant that gets an empty list abandons the
        // route rather than broadening its query. That is not hypothetical: this label once read
        // "Show the preview big, filling the admin content area" while the button said "Show full
        // screen", and on a recorded demo an assistant asked to show the preview full screen called
        // `page.find_elements({query:"full"})`, got `{"elements":[]}`, and gave up.
        //
        // So both directions carry the whole vocabulary, including the opposite direction's: a model
        // that asks for "fullscreen" while it is ALREADY full screen must find this control and read
        // "Exit full screen" off it, which tells it the state. Returning nothing instead teaches it
        // the feature does not exist. Direction is communicated by what the label SAYS, never by
        // being absent from the index. Keep in step with `aria-label`/`title` above —
        // `post-editor-agent-drive.unit.test.tsx` pins both the vocabulary and that agreement.
        // Prose, not a keyword dump — every synonym below is worked into a real sentence a person
        // can read. Note this string is NOT the accessible description: `agentHandle` emits it as
        // the plain data attribute `data-agent-label` (`handle.ts`), never `aria-label` or
        // `aria-describedby`, so no screen reader reads it. The accessible name is the `aria-label`
        // above, and the two are kept in agreement by test, not by sharing a string.
        label: expanded
          ? "Exit full screen: exit fullscreen to collapse or close the expanded preview, putting it back to its normal, smaller size. Already maximized, so if the ask was to show it big, it already is."
          : "Show the preview full screen: fullscreen the panel to maximize or expand it, and show it big across the whole admin content area.",
      })}
    >
      <span aria-hidden="true">{expanded ? "\u2921" : "\u2922"}</span>
    </button>
  );
}

/**
 * The preview's data source: which surface to show (`resolvePostPreviewBranches`) and the measured
 * pane the device frame scales into. Called above `PostPreview`'s early return, as before.
 */
function usePostPreviewSource({
  status,
  scheduled,
  dirty,
  contentDirty,
  usePreviewPaneWidthHook, resolvePostPreviewBranches,
}: {
  usePreviewPaneWidthHook: Parameters<typeof PostPreview>[0]["usePreviewPaneWidthHook"];
  resolvePostPreviewBranches: Parameters<typeof PostPreview>[0]["resolvePostPreviewBranches"];
  status: "draft" | "published";
  scheduled: boolean;
  dirty: boolean;
  contentDirty: boolean;
}) {
  // The same decision `usePostEditor` gates its auto-submit on — one shared copy in `rules.ts`, see
  // `resolvePostPreviewBranches`. `PostPreviewFrame` needs only the first two flags: the
  // pending-content surface is its unconditional final case.
  const { canShowLiveSite, canShowTemplatePreview } = resolvePostPreviewBranches({ status, scheduled, dirty, contentDirty });
  // Component-scoped like `ThemeExplorePreview`'s: the frame mounts/unmounts with this tab.
  const { frameRef, paneWidth } = usePreviewPaneWidthHook();
  return { canShowLiveSite, canShowTemplatePreview, frameRef, paneWidth };
}

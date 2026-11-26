import type { ComponentType, ReactNode } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { pagePreviewYoutubeIds } from "./lib/page-preview-youtube.js";
import { PAGE_PREVIEW_IFRAME_SANDBOX } from "./page-editor-rules.js";
import type { Translate } from "@jini-ai/core/text";

/**
 * @file The Page editor's Preview surface — `PagePreview`, its fullscreen fab and its two-branch
 * frame — split out of `PageEditor.tsx` (size debt) with their why-comments intact. Component
 * identities are module-level and stable, so the form + iframe pair survives fullscreen toggles.
 */

/** What `PagePreview` needs to ask which template-rendered videos the sandboxed preview contains —
 *  bundled so the editor threads ONE prop down to the pane, then spread into `PagePreview`'s own props
 *  (the hook stays a top-level, required hook prop there). */
export interface PreviewEmbeds {
  /** The real post id (never the slug) and the preview URL's template tri-state, for embed inspection. */
  pageId: string;
  templateChoice: string | null;
  /** REQUIRED hook prop (bound to the authenticated port in `panels.tsx`, a fake in tests): the
   *  template-rendered video ids the sandboxed preview document cannot hand the admin frame. */
  hooks: {
    usePreviewEmbedIds: (required: { id: string; templateChoice: string | null; version: number; previewRevision: string | number; pendingHtml: string | null }) => readonly string[];
    useThemePreviewFrameHook: (required: { liveUrl: string; templateUrl: string; canShowLiveSite: boolean }, optional: { navigation: "entry" }) => { liveUrl: string; templateUrl: string; canShowLiveSite: boolean; revision: string | number };
  };
}

/**
 * Renders the page at a fixed viewport width and scales the whole thing down to fit the pane.
 *
 * The scale is a CSS transform on a fixed-width box, not a responsive iframe, and that difference is
 * the entire point — see `DEVICE_PREVIEW_WIDTHS`. The wrapper's height is scaled to match so the
 * transformed content does not leave a gap or overflow underneath it. Both branches below fill this
 * same scaled box identically (`.page-preview-iframe` sets `width/height: 100%` on either element),
 * so `3ac885e`'s live pane-width tracking and the toolbar-to-preview spacing are unaffected by which
 * branch renders.
 *
 * **What this shows, and why (2026-08-11 — the theme-CSS gap was diagnosed, not assumed a
 * regression)**: this component previously fed the page's raw stored body HTML into
 * `SrcDocSandbox` — a sandboxed `srcdoc` iframe with no template wrapper, no nav/footer, and no
 * theme stylesheet, regardless of the page's template choice. That was never wired to the real
 * render path; it cannot have regressed, because it never rendered themed. Rather than reimplement
 * that whole server-side render pipeline a second time in the admin (a second source of truth that
 * would drift from `src/server/routes/site/pages.ts`'s real one), it shares the real pipeline
 * instead of one, through two branches:
 *
 * 1. **Saved content** (`status === "published" && !dirty`): GETs the authenticated template-preview
 *    endpoint. Consent is excluded there because this opaque-origin sandbox cannot save a choice.
 * 2. **Template preview** (everything else — a draft, or a published page with a pending
 *    `templateChoice` and/or edited content): a hidden `<form method="post" target="{iframe name}">`
 *    POSTs the working-copy `html` into `templatePreviewUrl` (`usePageEditor`'s pre-built URL,
 *    `port.templatePreviewUrl`/`lib/api.ts`'s own `templatePreviewUrl` — the admin-only render
 *    through the SAME pipeline as branch 1: `renderViaTemplate`,
 *    `host src/server/inbound/admin-http/routes/posts/template-preview.ts`, looked up by id instead of by public slug), landing
 *    the response inside a same-named `<iframe>`. `POST`, not the plain `GET` `<iframe src>` this
 *    branch used before 2026-09-09, because a `GET` can only carry `templateChoice` on the query
 *    string — it cannot hand the endpoint this page's own PENDING, possibly-unsaved `html`, which is
 *    exactly what a draft (or a published-but-dirty page) needs previewed. The debounced auto-submit
 *    effect (`usePageEditor`'s `schedulePendingHtmlPreviewSubmit`) fires this on template-choice
 *    change, body change, and switching into this tab — see that function's own doc for the "why a
 *    form submit, not `fetch`" reasoning, which mirrors `use-post-editor.hooks.ts`'s identical
 *    mechanism for Posts almost exactly (a `bodyHtml` field here where that one sends `bodyJson`).
 *
 *    Once a genuine per-id `bodyHtml` override existed server-side (`template-preview.ts`'s
 *    `pendingBodyHtml`, 2026-09-09 — see that file's own header), this branch no longer needs
 *    `status === "published"`: `findPublishedPostById`'s visibility guard on a draft's own
 *    `{"type":"content"}` slot is bypassed for exactly the one id this authenticated caller already
 *    fetched and authorized, the same way the PRE-EXISTING `bodyJson` override already did for a
 *    Post — see `resolveHtmlFormatContentMarkers`'s own doc for the full reasoning. That is what
 *    retired the THIRD branch this function used to have (a raw `SrcDocSandbox` fallback for a
 *    draft, or a published-and-dirty page): branch 2 is now simply "not the live site", so the two
 *    branches are exhaustive by construction and the fallback had become dead code, not merely rare
 *    — removed rather than left unreachable. This is also why only `canShowLiveSite` is computed
 *    below: its negation needs no name of its own. (`draftHtml`'s own textarea
 *    still exists on the HTML tab for hand-editing raw markup; nothing about that tab changed here.)
 *
 * Both branches use the existing authenticated API route (and its dev proxy), so the parent can
 * navigate the iframe with its session. The document itself remains sandboxed in an opaque origin;
 * it cannot read the admin document or save consent. A real URL preserves theme asset resolution.
 *
 * Preview fullscreen (2026-09-16). Expanding widens the PANE, never the previewed page: the
 * Desktop/Tablet/Mobile choice (`DEVICE_PREVIEW_WIDTHS`, the `page-preview-width-*` buttons) is the
 * operator's statement about which viewport they are inspecting, so it is carried into the expanded
 * panel unchanged rather than overridden to Desktop. Overriding would silently discard a selection
 * they just made and would make the single most useful thing this control can do — look at the
 * mobile layout properly — impossible. It also pays off arithmetically: `scale` is
 * `min(1, paneWidth / width)`, so a 390px Mobile preview that a narrow pane was scaling DOWN
 * renders at a true 1:1 once the pane is wide enough, and Desktop on a narrow pane keeps the
 * scaled-down behavior it already had. `pages.css`'s `.page-preview-expanded .page-preview-scaler`
 * centres it; see that rule for why `auto` margins are the right tool for both regimes.
 */
export function PagePreview({
  html,
  bodyJson,
  width,
  slug,
  version,
  status,
  dirty,
  contentDirty,
  templatePreviewUrl,
  previewFormRef,
  previewFormTarget,
  frameRef,
  paneWidth,
  expanded,
  onToggleExpanded,
  onFrameLoad,
  pageId,
  templateChoice,
  hooks,
  kit,
  deps,
  t,
}: PreviewEmbeds & {
  html: string;
  bodyJson?: Record<string, unknown> | undefined;
  width: number;
  slug: string;
  /** Cache-busts the live-site branch's `src` — see `PagePreviewFrame`'s own doc. */
  version: number;
  status: "draft" | "published";
  dirty: boolean;
  contentDirty: boolean;
  /** Pre-built by `usePageEditor` — see this function's own doc, branch 2. */
  templatePreviewUrl: string;
  /** Owned by `usePageEditor` — see `PageEditorController.previewFormRef`'s own doc for why the
   *  debounced auto-submit effect that reaches through this ref lives there, not here. */
  previewFormRef: (node: HTMLFormElement | null) => void;
  /** The hidden form's `target` and the iframe's `name` it submits into — must match at submit time. */
  previewFormTarget: string;
  /** Frame element to measure and its live-measured width — both owned by `usePageEditor`
   *  (`hooks/use-page-editor.hooks.ts`), not local state, so they survive this component's own
   *  mount/unmount as the operator switches tabs. `frameRef` is a CALLBACK ref, not a `RefObject` —
   *  see that hook's own comment on why the measuring effect there is keyed on the frame node itself
   *  rather than `view` or an empty dependency array. */
  frameRef: (node: HTMLDivElement | null) => void;
  paneWidth: number;
  /** Preview fullscreen (2026-09-16) — see `PageEditorController.previewExpanded`'s own doc for the
   *  state's lifetime, and this component's own doc for what expanding does and does NOT change. */
  expanded: boolean;
  /** `usePageEditor`'s `togglePreviewExpanded`, bound to the single `.page-preview-fab` this
   *  component renders in BOTH states. Nothing in `PageEditor`'s toolbar toggles it. */
  onToggleExpanded: () => void;
  /** Per-tab scroll memory — see `PageEditorController.onPreviewFrameLoad`'s own doc. Wired to both
   *  `PagePreviewFrame` branches' `<iframe onLoad>` below. */
  onFrameLoad: (iframe: HTMLIFrameElement) => void;
  /** REQUIRED hook prop: the theme preview refresh hook, bound at the editor's composition point so
   *  tests can drive `revision` without the live theme-refresh channel. */
  kit: { DevicePreviewFrame: ComponentType<{ width: number; frameRef: (node: HTMLDivElement | null) => void; paneWidth: number; expanded?: boolean; children: ReactNode }> };
  deps: { videoLink: (required: { id: string }) => string };
  t: Translate;
}) {
  const { usePreviewEmbedIds, useThemePreviewFrameHook } = hooks;
  const { DevicePreviewFrame } = kit;
  const canShowLiveSite = status === "published" && !dirty;
  // Lifted from `PagePreviewFrame` so the frame and the embed lookup share ONE result: the same
  // `revision` that refreshes the iframe re-asks for its video ids.
  const fresh = useThemePreviewFrameHook({
    // Opaque-origin previews cannot save consent; the authenticated route already excludes its gate.
    liveUrl: templatePreviewUrl,
    templateUrl: templatePreviewUrl,
    canShowLiveSite,
  }, { navigation: "entry" });
  const embedIds = usePreviewEmbedIds({
    id: pageId, templateChoice, version, previewRevision: fresh.revision,
    // A GET preview sends no pending body; the hidden-form POST sends the same `bodyHtml` the form does.
    pendingHtml: fresh.canShowLiveSite ? null : html,
  });
  // Page-owned ids stay the fallback; inspected ids only ever add to them.
  const youtubeIds = [...new Set([...pagePreviewYoutubeIds({ html, bodyJson }), ...embedIds])];

  // ONE element tree in both states, only the outer class changes (2026-10-05 owner bug). The two
  // states used to return different trees, so every toggle unmounted the form + iframe pair and
  // mounted an empty `about:blank` one: a draft's preview went blank (fixed at the root by
  // `usePageEditor`'s node-keyed re-submit) and even a working toggle reloaded the page under the
  // operator. Keeping the same nodes keeps the rendered document, and its scroll, across the toggle.
  //
  // Expanded: `.page-preview-expanded` (`styles/pages.css`) is `position: absolute; inset: 0`
  // against `.admin-main-col` — see `styles/editor.css`'s `.post-preview-expanded` comment for the
  // full containment argument (why this covers only the admin content column, never
  // `.admin-chat-dock`); Pages reuses the geometry and the `z-index`, not the rule.
  //
  // `.page-preview-stage` wraps the frame and the control and is the `position: relative` box the
  // fab's `position: absolute` resolves against (`pages.css`), so the fab always sits INSIDE the
  // previewed area — never over the notice line above it, which is where it landed when the whole
  // surface (notice included) was its containing block.
  return (
    <div className={expanded ? "page-preview-expanded" : "page-preview-host"}>
      <div className="page-preview-surface">
        <p className="field-hint editor-preview-note">{t("Cookie banner hidden in preview. Embedded videos may not play here; open the page to check.")}</p>
        <div>{youtubeIds.map(id => <a key={id} href={deps.videoLink({ id })} target="_blank" rel="noopener noreferrer">{t("Watch on YouTube")}</a>)}</div>
        <div className="page-preview-stage">
          {/* Collapsed vs. expanded frame/scaler heights: see `devicePreviewFrameStyles`. */}
          <DevicePreviewFrame width={width} frameRef={frameRef} paneWidth={paneWidth} expanded={expanded}>
            <PagePreviewFrame
              fresh={fresh}
              slug={slug}
              version={version}
              html={html}
              previewFormRef={previewFormRef}
              previewFormTarget={previewFormTarget}
              onFrameLoad={onFrameLoad}
              t={t}
            />
          </DevicePreviewFrame>
          <PagePreviewFab expanded={expanded} onToggle={onToggleExpanded} t={t} />
        </div>
      </div>
    </div>
  );
}

/**
 * The one control that toggles the preview between its normal pane and the full-screen panel,
 * rendered in the SAME place in both states so the way out is always visible on screen — the
 * failure that killed an earlier overlay attempt was an operator who could not see how to get back.
 * A top-level component rather than inline JSX so its three state ternaries score in their own
 * scope, the same reason `PagePreviewFrame` below is one.
 *
 * The glyph is `aria-hidden`, so `aria-label` is the ONLY thing naming this button for a screen
 * reader; keep the two directions' names distinct. `data-agent-label` is a SEPARATE string and is
 * NOT an accessible description — `agentHandle` emits only `data-agent-element/-role/-label/-page`
 * (`handle.ts`), never `aria-label`/`aria-describedby`, so widening it carries no a11y consequence
 * and nobody should "fix" a11y by editing it.
 */
function PagePreviewFab({ expanded, onToggle, t }: { expanded: boolean; onToggle: () => void; t: Translate }) {
  return (
    <button
      type="button"
      className="page-preview-fab"
      onClick={onToggle}
      aria-label={expanded ? t("Exit full screen") : t("Show full screen")}
      {...agentHandle({ handle: "page-preview-expand" }, {
        role: "button",
        // These labels read redundantly ON PURPOSE. `page.find_elements`'s `query` is a plain
        // case-insensitive SUBSTRING match over handle and label only — no stemming, no synonyms,
        // no ranking, and `role` is not searched at all (`@jini-ai/agentic`'s `dom-page-driver.ts`,
        // `findElements`) — so a word that is not literally here retrieves NOTHING, and an
        // assistant that gets an empty list abandons the route rather than broadening its query.
        // That is not hypothetical: the Posts twin's label once read "Show the preview big, filling
        // the admin content area" while the button said "Show full screen", and on a recorded demo
        // an assistant asked to show the preview full screen called
        // `page.find_elements({query:"full"})`, got `{"elements":[]}`, and gave up.
        //
        // The durable rule that came out of that, and which both editors now follow: every word of
        // the button's own `aria-label` must appear in the label published to agents, and both
        // spellings — "full screen" and "fullscreen" — must be present, since they are different
        // substrings. Both directions also carry the OPPOSITE direction's vocabulary: a model that
        // asks for "fullscreen" while it is ALREADY full screen must find this control and read
        // "Exit full screen" off it, which tells it the state. Returning nothing instead teaches it
        // the feature does not exist. Direction is communicated by what the label SAYS, never by
        // being absent from the index. Prose, not a keyword dump — every synonym is worked into a
        // real sentence a person can read. Kept under `normalizeAgentLabel`'s 200-character
        // truncation (`handle.ts`), past which text is still matchable but invisible in a listing;
        // the agent-drive test pins both the vocabulary and that length.
        label: expanded
          ? "Exit full screen: exit fullscreen to collapse or close the expanded preview, putting it back to its normal, smaller size. Already maximized, so if the ask was to show it big, it already is."
          : "Show the preview full screen: fullscreen this page preview to maximize or expand it and show it big across the admin content area, at the Desktop, Tablet or Mobile width already chosen.",
      })}
    >
      <span aria-hidden="true">{expanded ? "\u2921" : "\u2922"}</span>
      {/* The hint is drawn in-page, not the native `title` tooltip (2026-10-05): the desktop app
          drew the native one past the window's right edge ("Exit f…"). Anchored to the button and
          opening leftwards (`pages.css`), it stays inside the preview. `aria-hidden` because
          `aria-label` above already names the button; this only repeats it visually. */}
      <span className="page-preview-fab-tip" aria-hidden="true">
        {expanded ? t("Exit full screen (Esc)") : t("Show full screen")}
      </span>
    </button>
  );
}

/**
 * The two-way surface choice from `PagePreview`'s own doc comment (live site / template preview), as
 * a top-level function so its branching scores independently of `PagePreview`'s own complexity — same
 * pattern `PageEditorToolbarEnd` above uses for `PageEditor`'s own render branches.
 */
function PagePreviewFrame({
  fresh,
  slug,
  version,
  html,
  previewFormRef,
  previewFormTarget,
  onFrameLoad,
  t,
}: {
  /** `useThemePreviewFrame`'s result, owned by `PagePreview` (shared with the embed lookup). */
  fresh: { liveUrl: string; templateUrl: string; canShowLiveSite: boolean };
  slug: string;
  /** Remount the no-store authenticated GET after an assistant saves a new version. */
  version: number;
  html: string;
  previewFormRef: (node: HTMLFormElement | null) => void;
  previewFormTarget: string;
  /** Per-tab scroll memory — see `PageEditorController.onPreviewFrameLoad`'s own doc. Wired to both
   *  branches' `onLoad` below: cross-origin (the live-site branch) it silently does nothing. */
  onFrameLoad: (iframe: HTMLIFrameElement) => void;
  t: Translate;
}) {
  if (fresh.canShowLiveSite) {
    return (
      <iframe
        key={`${fresh.liveUrl}-${slug}-${version}`}
        src={fresh.liveUrl}
        title={t("Page preview")}
        className="page-preview-iframe"
        sandbox={PAGE_PREVIEW_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        onLoad={(e) => onFrameLoad(e.currentTarget)}
      />
    );
  }
  return (
    <>
      {/* `hidden`, not left out of the DOM — a hidden form still submits fine, and this keeps it
          out of layout without relying on CSS. Posts to the same `templatePreviewUrl` a plain `GET`
          used to point this iframe's `src` at directly — `templateChoice` rides that URL's own query
          string exactly as it did there, so a pending template choice AND a pending body are both
          honored by one submit. Mirrors `PostEditor.tsx`'s identical `PostPreviewFrame` branch 3
          almost exactly (a `bodyHtml` field here where that one sends `bodyJson`). */}
      <form key={`form-${fresh.templateUrl}`} ref={previewFormRef} method="post" target={previewFormTarget} action={fresh.templateUrl} hidden>
        <input type="hidden" name="bodyHtml" value={html} />
      </form>
      <iframe
        key={fresh.templateUrl}
        name={previewFormTarget}
        title={t("Page preview")}
        className="page-preview-iframe"
        sandbox={PAGE_PREVIEW_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        onLoad={(e) => onFrameLoad(e.currentTarget)}
      />
    </>
  );
}


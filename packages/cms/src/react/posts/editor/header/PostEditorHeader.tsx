import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { ComponentType } from "react";


/**
 * The editor header — the back link, the title and the slug (owner, 2026-10-10: the title and slug
 * replaced the kicker/"Edit post"/description block). Since the 2026-09-06 layout experiment the
 * save status, status select and the publish/save/delete buttons live in `PostEditorActions` below
 * the toolbar.
 *
 * Title and slug have shared one row since 2026-08-11 (owner: "put the slug input right next to the
 * title ... like we did the pages"), title capped on the left, slug group right-justified. The Pages
 * editor's header uses the same `content-editor-*` classes since 2026-10-10.
 *
 * The back link keeps its kind-aware `href`/label pair and its unsaved-work guard.
 */
export function PostEditorHeader({
  kindLabel,
  confirmLeave,
  title,
  setTitle,
  slug,
  setSlug,
  post,
  t,
  Icon,
  siteUrl,
}: {
  Icon: ComponentType<{ name: "arrow-left"; size: number; "aria-hidden": "true" }>;
  siteUrl(required: { path: string }, optional?: Record<string, never>): string;
  kindLabel: "post" | "page";
  confirmLeave: () => boolean;
  title: string;
  setTitle: (input: { next: string }) => void;
  slug: string;
  setSlug: (input: { value: string }) => void;
  /** The saved identity — a local working copy has no live URL before first Save. */
  post: { id: string; slug: string };
  t: Translate;
}) {
  return (
    // Owner, 2026-10-10: the "CONTENT / Edit post / Update this post's title, body, and publish
    // status." header told the operator nothing they couldn't see, so the title and slug took its
    // place. The title is a two-line box with a capped width; the slug keeps the right side. The page
    // still has an h1 for screen readers, just not a painted one.
    <div
      className="content-editor-header"
      {...agentHandle({ handle: "post-header" }, {
        role: "region",
        label:
          "Editor header — the back link, the title and the URL slug. Save, Delete and the " +
          "Draft/Published field are NOT here: they are in the action row below the view toolbar.",
      })}
    >
      <h1 className="visually-hidden">{t(kindLabel === "page" ? "Edit page" : "Edit post")}</h1>
      <PostEditorBackLink kindLabel={kindLabel} confirmLeave={confirmLeave} t={t} Icon={Icon} />
      <PostEditorTitleSlugFields title={title} setTitle={setTitle} slug={slug} setSlug={setSlug} post={post} t={t} siteUrl={siteUrl} />
    </div>
  );
}

/* Audit finding: no editor screen warns before an in-app navigation discards unsaved
    edits — confirmed live on this exact screen (edit the title, click this link, the
    edit is gone with no dialog). `preventDefault()` here also stops `router.ts`'s
    document-level click interceptor from firing `navigate()`, since that listener's
    first check is `event.defaultPrevented` — no change to `router.ts` needed. `btn-secondary`
    sits directly on this `<a>` (matches Forms/Posts' own "back"/"new" link idiom); a nested
    `<button>` used to carry that class instead, which is invalid HTML — `<a>` has no
    interactive content model — so it moved onto the real navigating element itself.

    Kind-aware `href`/label, reusing the same `post.kind` check `remove()` already makes
    for its post-delete redirect just below — bug found during the page-header pass: this
    link used to be hardcoded to "/admin/posts"/"← Posts" even while editing a *page*, so
    it silently returned an operator to the wrong list. Deriving both from `kindLabel`
    (not two independent ternaries) is what stops them drifting apart again.

    Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
    button reads the same short way now). `aria-label` keeps the kind-aware destination —
    "Back: Pages"/"Back: Posts", colon-joined rather than concatenated into a sentence so
    it needs no new per-locale phrase key and still starts with the exact visible text
    (WCAG 2.5.3 Label in Name). `agentHandle`'s own `label` (a stable, untranslated
    identifier — never live text) is unchanged. */
function PostEditorBackLink({
  kindLabel,
  confirmLeave,
  t,
  Icon,
}: {
  Icon: ComponentType<{ name: "arrow-left"; size: number; "aria-hidden": "true" }>;
  kindLabel: "post" | "page";
  confirmLeave: () => boolean;
  t: Translate;
}) {
  return (
    <a
      className="content-editor-back"
      href={`/admin/${kindLabel}s`}
      onClick={(e) => {
        if (!confirmLeave()) e.preventDefault();
      }}
      aria-label={`${t("Back")}: ${kindLabel === "page" ? t("Pages") : t("Posts")}`}
      {...agentHandle({ handle: "post-back-to-list" }, { role: "link", label: `Back to the list of all ${kindLabel}s` })}
    >
      {/* Owner, 2026-10-10: a plain back arrow, no button box. The `aria-label` above names it. */}
      <Icon name="arrow-left" size={22} aria-hidden="true" />
    </a>
  );
}

/* Audit finding: placeholder-only, no `<label>` — a screen reader gets nothing (title) or
    the bare `type="text"` announcement (slug, which had no placeholder either). The
    wrapping `<label>` + `.visually-hidden` text gives each a real accessible name without
    adding a visible caption above this screen's large title/slug controls (see
    `styles/editor.css`'s `.a11y-label-wrap` comment for why the wrap costs no layout).
    A title is one line of text, so Enter does nothing and pasted line breaks become spaces;
    the box grows to a second line only when the title needs it (CSS `field-sizing`). */
function PostEditorTitleSlugFields({
  title,
  setTitle,
  slug,
  setSlug,
  post,
  t,
  siteUrl,
}: {
  siteUrl(required: { path: string }, optional?: Record<string, never>): string;
  title: string;
  setTitle: (input: { next: string }) => void;
  slug: string;
  setSlug: (input: { value: string }) => void;
  /** The saved identity — a local working copy has no live URL before first Save. */
  post: { id: string; slug: string };
  t: Translate;
}) {
  return (
    <>
      <label className="a11y-label-wrap content-editor-title-wrap">
        <span className="visually-hidden">{t("Post title")}</span>
        <textarea
          className="editor-title content-editor-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle({ next: e.target.value.replace(/[\r\n]+/g, " ") })}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={t("Post title")}
          {...agentHandle({ handle: "post-title" }, { role: "field", label: "This post's title" })}
        />
      </label>
      <div className="editor-slug">
        /{" "}
        <label className="a11y-label-wrap">
          <span className="visually-hidden">{t("URL slug")}</span>
          <input
            value={slug}
            onChange={(e) => setSlug({ value: e.target.value })}
            {...agentHandle({ handle: "post-slug" }, { role: "field", label: "URL slug this post is published at" })}
          />
        </label>
        {post.id && post.slug ? <a
          href={siteUrl({ path: `/${post.slug}` }, {})}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: "post-view-live" }, { role: "link", label: "Open this post on the public site in a new tab" })}
        >
          {t("view ↗")}
        </a> : null}
        {/* The internal id used to be surfaced here as a read-only field (2026-08-10). Removed
            2026-08-11: the slug immediately to the left is now the record's routing key
            (`getAdminPostByIdOrSlug` resolves slug FIRST, id second) and is the only identity an
            author ever types or reads. Two id generators have been in play — seed literals like
            `post-about` and `idGen.newId()` UUIDs — so the stored id is neither stable in shape
            nor meaningful, and displaying it beside the real handle presented an implementation
            detail as though it were the record's identity. It is still reachable through the API
            and the row list; it just no longer competes with the slug for the author's attention. */}
      </div>
    </>
  );
}

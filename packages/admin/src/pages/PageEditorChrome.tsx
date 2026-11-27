import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { PageEditorProps } from "./PageEditor.js";
import type { PageEditorController } from "./hooks/use-page-editor.hooks.js";
import type { PageEditorView } from "./page-editor-rules.js";

const VIEWS: ReadonlyArray<{ key: PageEditorView; label: string }> = [
  { key: "html", label: "HTML" },
  { key: "interactive", label: "Interactive" },
  { key: "preview", label: "Preview" },
];

/** {@link VIEWS} carrying the `id` that `TabBar.hooks.tsx`'s WAI-ARIA tabs helpers key on, so this
 *  hand-rolled `role="tablist"` row gets the same arrow/Home/End keys and roving tab stop `TabBar`
 *  has (a35ce9f12) without becoming a `<TabBar>`: the `.segmented` pill row is a different visual
 *  control, only the keyboard contract is shared. Spread, not rebuilt, so nothing in the JSX below
 *  has to change which field it reads. */
export const VIEW_TABS = VIEWS.map((entry) => ({ ...entry, id: entry.key }));

/**
 * The status select, save feedback and the publish/save/delete buttons — their own row, below the
 * view/device toolbar rather than in the header (owner request, 2026-09-06: "put the published save
 * and delete buttons under the gray desktop/tablet/mobile row").
 *
 * This is where `PageEditorHeader`'s branching went when the controls moved: the message/error
 * spans, the publish button's conditional render, the save button's className, and its
 * "Saving…"/"Save •"/"Save" label are five independent decisions, and as a top-level function they
 * are scored in their own scope instead of accumulating onto `PageEditor`'s or the header's.
 *
 * `.editor-action-row` (`styles.css`) is shared with `features/posts/PostEditor.tsx`'s own
 * `PostEditorActions`; the two components are NOT merged, because that one's copy runs through `t`
 * and this screen's doesn't (2026-09-06: both now carry `agentHandle` tags — only the i18n split
 * remains as the reason not to merge them).
 */
/** "Save", marked with a bullet while there are unsaved changes. */
function saveLabel({ dirty, t }: { dirty: boolean; t: Translate }, _optional = {}): string {
  return dirty ? `${t("Save")} •` : t("Save");
}

/**
 * The editor header — the back arrow, the title and the slug (owner, 2026-10-10: these replaced the
 * kicker/title/description block, matching the Edit post screen). Since the 2026-09-06 layout
 * experiment the save status, status select and the publish/save/delete buttons live in
 * `PageEditorActions` below the toolbar.
 *
 * That move took this component's branching with it, so the extraction note this doc used to carry
 * now belongs to `PageEditorActions` instead — see there. What is left here is inert markup plus
 * the one unsaved-work guard on the back link, which is why `onBackLinkClick` is the only prop that
 * stayed (was `confirmLeave` until 2026-09-24, when the guard also had to flush the Interactive tab
 * first — see `PageEditorController.onBackLinkClick`).
 *
 * `confirmLeave` (2026-09-06, standing-draft autosave dispatch) replaces what used to be an inline
 * `dirty && !window.confirm(...)` check written directly in this component — the exact
 * logic-in-`.tsx` pattern this codebase's own convention keeps correcting (see
 * `use-post-editor.hooks.ts`'s own `useDirtyGuard` wiring, which `PostEditorHeader` already
 * consumed this same way). The comparison and the `window.confirm` call both now live in
 * `use-dirty-guard.hooks.ts`, tested once there rather than re-verified per screen.
 */
export function PageEditorHeader({ kit, deps,
  onBackLinkClick,
  title,
  setTitle,
  slug,
  setSlug,
  livePath,
  t,
}: { kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"];
  onBackLinkClick: (event: { preventDefault: () => void }) => Promise<void>;
  title: string;
  setTitle: (value: string) => void;
  slug: string;
  setSlug: (value: string) => void;
  /** The SAVED page's public path — "view ↗" opens what is live, not what is being typed. */
  livePath: string;
  t: Translate;
}, _optional = {}) {
  const { Icon } = kit;
  const { siteUrl } = deps;
  return (
    // Owner, 2026-10-10 (carried over from the Edit post screen the same day): the "CONTENT / Edit
    // page / Ask the assistant to build this page…" block told the operator nothing they couldn't
    // see, so the back arrow, title and slug took its place. Same `content-editor-*` classes as
    // `PostEditor.tsx`'s header (`styles/editor.css`). The page keeps an h1 for screen readers.
    <div
      className="content-editor-header"
      {...agentHandle({ handle: "page-header" }, {
        role: "region",
        label:
          "Editor header — the back link, the page's title and its URL slug. Save, Delete and the " +
          "Draft/Published field are NOT here: they are in the action row below the toolbar.",
      })}
    >
      <h1 className="visually-hidden">{t("Edit page")}</h1>
      {/* Guards an in-app navigation away from unsaved work — the same protection the agent's
          own navigation gate is meant to apply, applied here to a human click.

          A plain back arrow, no button box (owner, 2026-10-10). The destination stays named:
          `aria-label` composes this dictionary's own translated "Back"/"Pages" as "Back: Pages".
          `agentHandle`'s own `label` (a stable, untranslated identifier — never live text, see
          `handle.ts`) says "Back to the list of all pages" for agents, unchanged. */}
      <a
        className="content-editor-back"
        href="/admin/pages"
        onClick={(e) => void onBackLinkClick(e)}
        aria-label={`${t("Back")}: ${t("Pages")}`}
        {...agentHandle({ handle: "page-back-to-list" }, { role: "link", label: "Back to the list of all pages" })}
      >
        <Icon name="arrow-left" size={22} aria-hidden="true" />
      </a>
      {/* `editor-title`/`editor-slug` are the existing editor chrome from `styles/editor.css`.
          Title and slug have shared one row since 2026-08-11 (owner: "Cap the title input at half
          the page and then put the hacker news slug and view. Right justify it as the other half of
          that line of the title."). The title is one line, growing to a second only when it needs
          it; Enter does nothing and pasted line breaks become spaces, since a title is one line of
          text. */}
      <PageEditorTitle title={title} setTitle={setTitle} t={t} />
      <PageEditorSlug slug={slug} setSlug={setSlug} livePath={livePath} t={t} siteUrl={siteUrl} />
    </div>
  );
}

export function PageEditorActions({ dirty, message, error, status, setStatus, saving, onPublish, onSave, onDeleteClick, t }: {
  dirty: boolean;
  message: string | null;
  error: string | null;
  status: "draft" | "published";
  setStatus: (value: "draft" | "published") => void;
  saving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onDeleteClick: () => void;
  t: Translate;
}, _optional = {}) {
  return (
    <div
      className="editor-action-row content-action-row"
      {...agentHandle({ handle: "page-actions" }, {
        role: "region",
        label: "Save status, the Draft/Published field, and the Publish, Save and Delete buttons",
      })}
    >
      {/* Owner, 2026-10-10 (same as Edit post): Save and Delete sit right next to the status field
          as one tight group, at their natural size. */}
      <PageEditorActionGroup dirty={dirty} status={status} setStatus={setStatus} saving={saving} onPublish={onPublish} onSave={onSave} onDeleteClick={onDeleteClick} t={t} />
      {message ? <span className="save-ok">{message}</span> : null}
      {error ? <span className="save-error">{error}</span> : null}
    </div>
  );
}

/**
 * The toolbar's right-hand group — the device-width control (preview view only) and the template
 * picker. Extracted out of `PageEditor` for the same reason `PageEditorHeader` above was: this is
 * where nearly all of the remaining branching in that component's render lived (the preview-only
 * visibility check, the html-format check, and the has-templates check nested inside it), and as a
 * top-level function its branches are scored in their own scope instead of accumulating onto
 * `PageEditor`'s.
 *
 * Device-width control and template picker share this one row (owner feedback, 2026-08-11: "move the
 * UI for the template dropdown where the desktop tablet mobile is right now ... so it's all one row"
 * — the picker's own standalone row above is gone). `.page-editor-toolbar-end` is a plain grouping
 * wrapper (`pages.css`) so `.page-editor-toolbar`'s existing `justify-content: space-between` still
 * only has to place two things: the view tabs on the left, this group on the right.
 *
 * The template picker mirrors `PostEditor.tsx`'s own `.editor-template-picker` markup/classes
 * verbatim. Rendered only for an `"html"`-format Page: a `"doc"`-format Page (pre-conversion legacy
 * row) has no render path that would honor a template choice yet (`isEligibleForTemplateBranch`
 * requires `bodyFormat: "html"`), so showing the picker on one would let an operator set a value with
 * no visible effect.
 *
 * UNLIKE the Post picker, the selected value is NOT defaulted to the theme's first template when
 * unset — see `use-page-editor.hooks.ts`'s load effect and `isEligibleForTemplateBranch`'s doc for the
 * full reasoning: "no template chosen" is a Page's normal, fully-working state (render its own body
 * through the theme's own page shell — "Theme default"), not an absence-of-decision needing a UI
 * default to stay honest.
 *
 * Bare-page ruling (2026-09-23, S6): `null` and `""` used to render identically and this picker showed
 * both as "No template chosen". They now diverge — `null` still renders through the theme's page shell
 * ("Theme default"), `""` renders ONLY this Page's own HTML (no theme styles, scripts, header or
 * footer) — so the picker routes through {@link pagePickerValue}/{@link pickerValueToChoice} (`rules.ts`)
 * rather than `templateChoice ?? ""` directly, and shows a hint line under the `<select>` whenever the
 * bare option is selected.
 *
 * "View Template" eye button (2026-09-24, parity with `PostEditor.tsx`'s identical control): left of
 * the `<select>`, same shared `ViewTemplateButton` (`@jini-ai/admin/shell/components/TemplateSource/ViewTemplateButton`)
 * Posts renders, disabled whenever nothing is chosen ({@link templateChoice} falsy — covers both
 * "Theme default" (`null`) and the explicit bare "No template" (`""`), neither of which names a real
 * file to show). Opens `TemplateSourceModal` (`PageEditor`'s own `PageEditorTemplateModalGate` below).
 */
export function PageEditorToolbarEnd({ kit, deps,
  view,
  bodyFormat,
  availableTemplates,
  templateChoice,
  setTemplateChoice,
  onViewTemplateClick,
  t,
}: { kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"];
  view: PageEditorView;
  bodyFormat: "doc" | "html" | undefined;
  availableTemplates: string[];
  templateChoice: string | null;
  setTemplateChoice: (value: string | null) => void;
  onViewTemplateClick: () => void;
  t: Translate;
}, _optional = {}) {
  const { ViewTemplateButton, WiredThemePreviewReloadButton } = kit;
  const { pagePickerValue } = deps;
  const pickerValue = pagePickerValue({ templateChoice, availableTemplates });
  return (
    <div className="page-editor-toolbar-end">
      {view === "preview" ? <WiredThemePreviewReloadButton /> : null}
      {bodyFormat === "html" ? (
        <PageEditorTemplatePicker deps={deps} availableTemplates={availableTemplates} templateChoice={templateChoice} setTemplateChoice={setTemplateChoice} onViewTemplateClick={onViewTemplateClick} t={t} pickerValue={pickerValue} ViewTemplateButton={ViewTemplateButton} />
      ) : null}
    </div>
  );
}

function PageEditorTitle({ title, setTitle, t }: Pick<Parameters<typeof PageEditorHeader>[0], "title" | "setTitle" | "t">, _optional = {}) {
  return (
    <label className="a11y-label-wrap">
        <span className="visually-hidden">{t("Page title")}</span>
        <textarea
          className="editor-title content-editor-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={t("Untitled")}
          {...agentHandle({ handle: "page-title" }, { role: "field", label: "This page's title" })}
        />
      </label>
  );
}

function PageEditorSlug({ slug, setSlug, livePath, t, siteUrl }: Pick<Parameters<typeof PageEditorHeader>[0], "slug" | "setSlug" | "livePath" | "t"> & { siteUrl: PageEditorProps["deps"]["siteUrl"] }, _optional = {}) {
  return (
    <div className="editor-slug">
        <span>/</span>
        <label className="a11y-label-wrap">
          <span className="visually-hidden">{t("URL slug")}</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            {...agentHandle({ handle: "page-slug" }, { role: "field", label: "URL slug this page is published at" })}
          />
        </label>
        <a
          href={siteUrl({ path: livePath })}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: "page-view-live" }, { role: "link", label: "Open this page on the public site in a new tab" })}
        >
          {t("view ↗")}
        </a>
      </div>
  );
}

function PageEditorActionGroup({ dirty, status, setStatus, saving, onPublish, onSave, onDeleteClick, t }: Pick<Parameters<typeof PageEditorActions>[0], "dirty" | "status" | "setStatus" | "saving" | "onPublish" | "onSave" | "onDeleteClick" | "t">, _optional = {}) {
  return (
    <div className="content-action-group">
        <PageEditorStatusSelect status={status} setStatus={setStatus} t={t} />
        {status === "draft" ? (
          <button
            type="button"
            onClick={onPublish}
            disabled={saving}
            {...agentHandle({ handle: "page-publish" }, {
              role: "button",
              label:
                "Publish this page immediately — saves the current title, slug and body and sets " +
                "status to Published in one action. Only shown while the page is a draft; once " +
                "published, use Save for further edits.",
            })}
          >
            {t("Publish")}
          </button>
        ) : null}
        <button
          type="button"
          className={status === "draft" ? "btn-secondary" : undefined}
          onClick={onSave}
          disabled={saving}
          {...agentHandle({ handle: "page-save" }, { role: "button", label: "Save this page's title, slug, status and body" })}
        >
          {saving ? t("Saving…") : saveLabel({ dirty: dirty, t: t })}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onDeleteClick}
          {...agentHandle({ handle: "page-delete" }, {
            role: "button",
            label:
              "Move this page to the trash — different from unpublishing (the Draft/Published field " +
              "beside it): the entry disappears from every list and the site. Asks for confirmation " +
              "before deleting.",
          })}
        >
          {t("Delete")}
        </button>
      </div>
  );
}

function PageEditorStatusSelect({ status, setStatus, t }: Pick<Parameters<typeof PageEditorActionGroup>[0], "status" | "setStatus" | "t">, _optional = {}) {
  return (
    <select
          value={status}
          aria-label={t("Status")}
          onChange={(e) => setStatus(e.target.value as "draft" | "published")}
          {...agentHandle({ handle: "page-status" }, {
            role: "field",
            label:
              "Whether this page is a draft or published — set with page.select_option, not click. " +
              "Setting to Draft unpublishes it (content is kept, just hidden from the site); this is " +
              "NOT the same as Delete, which moves the whole entry to the trash.",
          })}
        >
          <option value="draft">{t("Draft")}</option>
          <option value="published">{t("Published")}</option>
        </select>
  );
}

function PageEditorTemplatePicker({ deps, availableTemplates, templateChoice, setTemplateChoice, onViewTemplateClick, t, pickerValue, ViewTemplateButton }: Pick<Parameters<typeof PageEditorToolbarEnd>[0], "availableTemplates" | "templateChoice" | "setTemplateChoice" | "onViewTemplateClick" | "t" | "deps"> & { pickerValue: string; ViewTemplateButton: PageEditorProps["kit"]["ViewTemplateButton"] }, _optional = {}) {
  return (
    <div className="editor-template-picker">
          <ViewTemplateButton
            disabled={!templateChoice}
            onClick={onViewTemplateClick}
            t={t}
            agentHandleId="page-view-template"
          />
          {availableTemplates.length > 0 ? (
            <PageEditorTemplateOptions deps={deps} availableTemplates={availableTemplates} setTemplateChoice={setTemplateChoice} t={t} pickerValue={pickerValue} />
          ) : (
            <select
              disabled
              value=""
              aria-label={t("Template")}
              {...agentHandle({ handle: "page-template-choice" }, {
                role: "field",
                label: "The active theme declares no page templates, so there is nothing to choose here.",
              })}
            >
              <option value="">{t("No templates for this theme")}</option>
            </select>
          )}
          {/* No hint line beside the select for "No template — HTML only" (owner, 2026-10-10): it
              ran off the right edge on phones and dragged the page sideways. The option's own name
              says what it does. */}
        </div>
  );
}

function PageEditorTemplateOptions({ deps, availableTemplates, setTemplateChoice, t, pickerValue }: Pick<Parameters<typeof PageEditorTemplatePicker>[0], "availableTemplates" | "setTemplateChoice" | "t" | "pickerValue" | "deps"> & { pickerValue: string }, _optional = {}) {
  const { pickerValueToChoice, THEME_DEFAULT_SENTINEL } = deps;
  return (
    <select
              value={pickerValue}
              aria-label={t("Template")}
              // `pickerValueToChoice`, not the raw `e.target.value` — translates the synthetic
              // `THEME_DEFAULT_SENTINEL` option back to `null`; every other value (a real filename, or
              // the bare `""`) already IS the `templateChoice` to store, see that function's own doc.
              onChange={(e) => setTemplateChoice(pickerValueToChoice({ value: e.target.value }))}
              {...agentHandle({ handle: "page-template-choice" }, {
                role: "field",
                label:
                  "Which theme page template this page renders through on the public site. 'No template' serves only the page's own HTML.",
              })}
            >
              <option value={THEME_DEFAULT_SENTINEL}>{t("Theme default")}</option>
              {availableTemplates.map((template) => (
                <option key={template} value={template}>
                  {template}
                </option>
              ))}
              <option value="">{t("No template — HTML only")}</option>
            </select>
  );
}

export function PageEditorHeaderSection({ editor, page, kit, deps }: { editor: PageEditorController; page: NonNullable<PageEditorController["page"]>; kit: PageEditorProps["kit"]; deps: PageEditorProps["deps"] }, _optional = {}) {
  const { title, setTitle, slug, setSlug, onBackLinkClick, t } = editor;
  const { pagePublicPath } = deps;
  return (
    <PageEditorHeader kit={kit} deps={deps}
        onBackLinkClick={onBackLinkClick}
        title={title}
        setTitle={setTitle}
        slug={slug}
        setSlug={setSlug}
        livePath={pagePublicPath({ slug: page.slug })}
        t={t}
      />
  );
}

export function PageEditorActionsSection({ editor }: { editor: PageEditorController;   }, _optional = {}) {
  const { error, message, status, setStatus, saving, dirty, save, setConfirmingDelete, onSave, t } = editor;
  return (
    <PageEditorActions
        dirty={dirty}
        message={message}
        error={error}
        status={status}
        setStatus={setStatus}
        saving={saving}
        onPublish={() => save("published")}
        onSave={onSave}
        onDeleteClick={() => setConfirmingDelete(true)}
        t={t}
      />
  );
}

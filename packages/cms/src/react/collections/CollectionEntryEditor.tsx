import type { ComponentType, Dispatch, SetStateAction } from "react";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { ContentTypeFieldDef } from "@jini-ai/core/contracts/content-types";

export interface CollectionEntryViewController<Body> {
  contentType: { label: string; fields: ContentTypeFieldDef[] } | null | undefined;
  entry: { id: string; slug: string; status: string; fieldsJson?: unknown } | null | undefined;
  title: string; setTitle: (value: string) => void;
  slug: string; setSlug: (value: string) => void;
  extFields: Record<string, unknown>; setExtFields: Dispatch<SetStateAction<Record<string, unknown>>>;
  message: string | null; error: string | null; loadError: string | null;
  loaded: boolean; saving: boolean; busy: boolean; editor: Body;
  save: () => void;
  toggleLifecycle: (required: { op: "publish" | "unpublish" }, optional?: Record<string, never>) => void;
  setFieldValidity: (fieldName: string, valid: boolean) => void;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

export interface CollectionEntryEditorProps<Body> {
  contentTypeKey: string;
  entryId: string | null;
  useCollectionEntryEditorHook: (required: { contentTypeKey: string; entryId: string | null }, optional?: Record<string, never>) => CollectionEntryViewController<Body>;
  useJsonFieldControlHook: (required: { value: unknown; onChange: (value: unknown) => void; fieldName: string; setFieldValidity: (fieldName: string, valid: boolean) => void }) => {
    text: string; parseError: boolean; handleTextChange: (required: { nextText: string }, optional?: Record<string, never>) => void;
  };
  BodyEditor: ComponentType<{ editor: Body }>;
  EntryTerms: ComponentType<{ contentType: string; contentId: string }>;
  ServerLabel: ComponentType<{ value: string }>;
  entryListHref: (required: { contentTypeKey: string }, optional?: Record<string, never>) => string;
  readStoredField: (required: { fieldsJson: unknown; name: string }, optional?: Record<string, never>) => unknown;
}

import { EntryFieldsSection } from "./CollectionEntryEditor.fields.js";

/** The page-header action cluster: back link, save/error status, and the status-dependent
 * Publish/Unpublish/Save button set. Split out of `CollectionEntryEditor` because this cluster
 * alone carried most of that function's branching — the entry's lifecycle status governs which
 * buttons and status pill are showing at once. */
/** Publish/Unpublish/Save — split out of `EntryPageActions` because the status-dependent branch
 * pairs (which lifecycle button shows, which class the Save button gets) alone pushed that
 * function's branch count over the ceiling; this trio is one coherent unit of "buttons driven by
 * publish state" on its own. */
function EntryLifecycleButtons(props: {
  entry: { status: string } | null | undefined;
  saving: boolean;
  /** True while save OR a lifecycle toggle is in flight (H2) — disables all three buttons, since
   *  Publish now runs a save leg before its lifecycle leg and either one being in flight must
   *  block a second click. `saving` alone stays the Save button's own LABEL source (unchanged). */
  busy: boolean;
  onToggleLifecycle: (required: { op: "publish" | "unpublish" }, optional?: Record<string, never>) => void;
  onSave: () => void;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}) {
  const { entry, saving, busy, onToggleLifecycle, onSave, t } = props;
  const isPublished = entry?.status === "published";

  return (
    <>
      {entry && !isPublished ? (
        <button
          type="button"
          onClick={() => onToggleLifecycle({ op: "publish" })}
          disabled={busy}
          {...agentHandle({ handle: "entry-publish" }, {
            role: "button",
            label: "Publish this entry immediately, saving its current title, fields and body",
          })}
        >
          {t({ key: "Publish" })}
        </button>
      ) : null}
      {/* Reversible-but-access-affecting (drops the entry off the site; still editable here,
          still re-publishable) — `.btn-warning`, matching `Posts.tsx`/`Pages.tsx` RowMenu's
          own Disable, not `.btn-danger`, which stays reserved for the genuinely destructive
          trash action. */}
      {entry && isPublished ? (
        <button
          type="button"
          className="btn-warning"
          onClick={() => onToggleLifecycle({ op: "unpublish" })}
          disabled={busy}
          {...agentHandle({ handle: "entry-unpublish" }, {
            role: "button",
            label: "Unpublish this entry — removes it from the live site without deleting it",
          })}
        >
          {t({ key: "Unpublish" })}
        </button>
      ) : null}
      {/* Secondary while Publish is also showing (draft entries) so the two don't compete for
          primary weight — mirrors `PostEditor.tsx`'s identical Save/Publish pairing exactly.
          Once published, Publish is gone and Save is this screen's one remaining primary
          action, so it goes back to bare/primary. */}
      <button
        type="button"
        className={entry && !isPublished ? "btn-secondary" : undefined}
        onClick={onSave}
        disabled={busy}
        {...agentHandle({ handle: "entry-save" }, { role: "button", label: "Save this entry's title, slug, fields and body" })}
      >
        {saving ? t({ key: "Saving…" }) : t({ key: "Save" })}
      </button>
    </>
  );
}

function EntryPageActions(props: {
  ServerLabel: ComponentType<{ value: string }>;
  entryListHref: CollectionEntryEditorProps<unknown>["entryListHref"];
  contentTypeKey: string;
  contentTypeLabel: string;
  entry: { status: string } | null | undefined;
  message: string | null;
  error: string | null;
  saving: boolean;
  busy: boolean;
  onToggleLifecycle: (required: { op: "publish" | "unpublish" }, optional?: Record<string, never>) => void;
  onSave: () => void;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}) {
  const { contentTypeKey, contentTypeLabel, entry, message, error, saving, busy, onToggleLifecycle, onSave, t, ServerLabel } = props;

  return (
    <div className="page-actions">
      {/* Plain `<a className="btn-secondary">`, not a `<button>` nested inside an `<a>` (invalid
          HTML, undefined activation behaviour) — same `a.btn-*` mechanism `Dashboard.tsx`'s
          "View site ↗" already uses. */}
      <a
        className="btn-secondary"
        href={props.entryListHref({ contentTypeKey })}
        {...agentHandle({ handle: "entry-back" }, { role: "link", label: "Back to this content type's list of entries" })}
      >
        ← {contentTypeLabel}
      </a>
      {message ? <span className="save-ok">{message}</span> : null}
      {error ? <span className="save-error">{error}</span> : null}
      {entry ? <span className={`status status-${entry.status}`}><ServerLabel value={entry.status} /></span> : null}
      <EntryLifecycleButtons
        entry={entry}
        saving={saving}
        busy={busy}
        onToggleLifecycle={onToggleLifecycle}
        onSave={onSave}
        t={t}
      />
    </div>
  );
}

/** The `/{slug}` row under the title: an existing entry's slug is immutable (plain text), a new
 * entry's slug is an editable field. Split out of `CollectionEntryEditor` alongside the fields
 * section below — both are self-contained "does this thing exist yet" branches that don't need
 * anything else in the parent's scope. */
function EntrySlugField(props: {
  entry: { slug: string } | null | undefined;
  slug: string;
  onSlugChange: (value: string) => void;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}) {
  const { entry, slug, onSlugChange, t } = props;
  return (
    <div className="editor-slug">
      /{" "}
      {entry ? (
        <span>{entry.slug}</span>
      ) : (
        <label className="a11y-label-wrap">
          <span className="visually-hidden">{t({ key: "Entry slug" })}</span>
          <input
            value={slug}
            onChange={(e) => onSlugChange(e.target.value)}
            placeholder="entry-slug"
            {...agentHandle({ handle: "entry-slug" }, {
              role: "field",
              label: "This entry's URL slug — only editable while creating a new entry",
            })}
          />
        </label>
      )}
    </div>
  );
}

export function CollectionEntryEditor<Body>(props: CollectionEntryEditorProps<Body>) {
  const useCollectionEntryEditorHook = props.useCollectionEntryEditorHook;
  const controller = useCollectionEntryEditorHook({ contentTypeKey: props.contentTypeKey, entryId: props.entryId });
  const { contentType, entry, loadError, loaded, t } = controller;
  if (loadError) return <div className="notice error">{loadError}</div>;
  if (!loaded || contentType === undefined) return <div className="notice">{t({ key: "Loading entry…" })}</div>;
  if (!contentType) return <div className="notice error">{t({ key: 'Unknown content type "{contentTypeKey}".' }).replace("{contentTypeKey}", () => props.contentTypeKey)}</div>;
  if (props.entryId && !entry) return <div className="notice error">{t({ key: "Entry not found." })}</div>;

  return (
    <div className="page">
      <EntryHeader props={props} controller={controller} contentType={contentType} />
      <EntryEditorBody props={props} controller={controller} contentType={contentType} />
    </div>
  );
}

function EntryHeader<Body>({ props, controller, contentType }: { props: CollectionEntryEditorProps<Body>; controller: CollectionEntryViewController<Body>; contentType: NonNullable<CollectionEntryViewController<Body>["contentType"]> }) {
  const { entry, message, error, saving, busy, toggleLifecycle, save, t } = controller;
  return (
      <div
        className="page-header"
        {...agentHandle({ handle: "entry-header" }, {
          role: "region",
          label: "Entry editor header — back link, save status, publish state and the Save button",
        })}
      >
        <div className="page-header-text">
          <p className="page-kicker">{t({ key: "Content" })}</p>
          <h1 className="page-title">
            {t({ key: entry ? "Edit {label} entry" : "New {label} entry" }).replace("{label}", () => contentType.label)}
          </h1>
          <p className="page-description">{t({ key: "Update this entry's title, fields, and body." })}</p>
        </div>
        <EntryPageActions
          ServerLabel={props.ServerLabel} entryListHref={props.entryListHref}
          contentTypeKey={props.contentTypeKey}
          contentTypeLabel={contentType.label}
          entry={entry}
          message={message}
          error={error}
          saving={saving}
          busy={busy}
          onToggleLifecycle={toggleLifecycle}
          onSave={save}
          t={t}
        />
      </div>
  );
}

function EntryEditorBody<Body>({ props, controller, contentType }: { props: CollectionEntryEditorProps<Body>; controller: CollectionEntryViewController<Body>; contentType: NonNullable<CollectionEntryViewController<Body>["contentType"]> }) {
  const { title, setTitle, entry, slug, setSlug, editor, extFields, setExtFields, setFieldValidity, t } = controller;
  const { BodyEditor, EntryTerms } = props;
  return (
    <>
      {/* Audit finding: placeholder-only, no `<label>` — same fix as `PostEditor.tsx`'s title/slug
          (see `styles/editor.css`'s `.a11y-label-wrap` comment). The slug field's label is only
          rendered in the `!entry` (create) branch, matching that branch's own `<input>`. */}
      <label className="a11y-label-wrap">
        <span className="visually-hidden">{t({ key: "Entry title" })}</span>
        <input
          className="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t({ key: "Entry title" })}
          {...agentHandle({ handle: "entry-title" }, { role: "field", label: "This entry's title" })}
        />
      </label>
      <EntrySlugField entry={entry} slug={slug} onSlugChange={setSlug} t={t} />

      <BodyEditor editor={editor} />

      <EntryFieldsSection
        useJsonFieldControlHook={props.useJsonFieldControlHook}
        readStoredField={props.readStoredField}
        fields={contentType.fields}
        entry={entry}
        extFields={extFields}
        onFieldChange={(name, value) => setExtFields((current) => ({ ...current, [name]: value }))}
        setFieldValidity={setFieldValidity}
        t={t}
      />

      {entry ? (
        <EntryTerms contentType={props.contentTypeKey} contentId={entry.id} />
      ) : null}
    </>
  );
}

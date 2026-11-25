import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { AdminContentType } from "./api/collections-api.types.js";
import type { CollectionsListParts } from "./collections-screen-parts.js";
import { renderCollectionsTable } from "./CollectionsTable.js";
import { EditFieldsDialog } from "./EditFieldsDialog.js";
import type { CollectionsController } from "./hooks/use-collections.hooks.js";
import { LifecycleConfirmDialog } from "./LifecycleConfirmDialog.js";
import { NewContentTypeDialog } from "./NewContentTypeDialog.js";
import type { LifecycleConfirmOp } from "./rules.js";

/**
 * @file Collections screen (design-spec.md §1, ADR-022/ADR-043) — the `/admin/collections`
 * landing view: the content-type registry list plus the "New content type" modal.
 *
 * Structural reference: `FormsList.tsx` (list/fetch/loading/error/empty shape) crossed with
 * `the former raw settings screen`'s `.settings-dialog` modal idiom, per design-spec.md §0.3/§1.3. The entry list
 * (`/admin/collections/{typeKey}`) and entry editor (`/admin/collections/{typeKey}/{entryId|new}`) are
 * separate routed screens — see `CollectionEntries.tsx`/`CollectionEntryEditor.tsx`.
 *
 * Reserved key + grammar validation (§1.3) is duplicated client-side as a fast-reject only; the
 * server's `VALIDATION_ERROR` (`InvalidKeyGrammarError`/`ReservedContentTypeKeyError`) is the
 * authoritative check, same disclosed pattern `the former raw settings screen`'s header comment documents for its
 * own client-side checks.
 *
 * `EditFieldsDialog` wires the previously-unused `api.updateContentTypeFields` —
 * post-creation field-schema editing, full-replace semantics (the whole `fields` array is sent),
 * optimistic-concurrency via `expectedVersion`. A `409` (stale version — another edit landed since
 * this dialog loaded) surfaces a dedicated "refresh and try again" message rather than silently
 * applying the stale write or falling through to the generic error banner.
 *
 * ## Markup only
 *
 * Every dialog's state lives in its own `hooks/use-<thing>.hooks.ts`; Jini now owns native
 * cancellation and focus. The former feature-local Escape helper consolidated identical
 * effects to avoid dropped/double Escape delivery when callbacks rebound on each render;
 * native cancellation removes the need for that subscription and its cleanup entirely.
 * Validation, draft-field-list transforms, error-message
 * formatting, and the row-menu builder all moved to `rules.ts`.
 *
 * Every host collaborator (the list hook, the three dialog hooks, the status label, the publish
 * button and the kit-bound row-menu builder) is a REQUIRED prop — see `collections-screen-parts.ts`.
 * The host imports its native-dialog stylesheet at the screen mount.
 */

// ---------------------------------------------------------------------------
// Collections — content-type list
// ---------------------------------------------------------------------------

export interface CollectionsProps extends CollectionsListParts {
  /** The list controller hook — REQUIRED. The host binds its wired `useCollections` (port, locale,
   *  kit); tests pass a double. */
  useCollectionsHook: () => CollectionsController;
}

/** The three modals `Collections` can have open at once (mutually exclusive in practice, but not
 * enforced as a union since the controller tracks them as three independent pieces of state).
 * Split out because each one is its own conditional-render branch on the parent — bundling all
 * three into one component keeps `Collections` itself down to the table + header. */
function CollectionsDialogs(props: {
  hooks: Pick<CollectionsListParts, "useNewContentTypeDialogHook" | "useEditFieldsDialogHook" | "useLifecycleConfirmDialogHook">;
  showNewDialog: boolean;
  onNewDialogCreated: () => void;
  onNewDialogCancel: () => void;
  pendingLifecycle: { op: LifecycleConfirmOp; contentType: AdminContentType } | null;
  onLifecycleConfirm: (op: LifecycleConfirmOp, contentType: AdminContentType) => void;
  onLifecycleCancel: () => void;
  editingFieldsFor: AdminContentType | null;
  onFieldsSaved: () => void;
  onFieldsCancel: () => void;
  t: CollectionsController["t"];
}) {
  const {
    hooks, showNewDialog, onNewDialogCreated, onNewDialogCancel, pendingLifecycle, onLifecycleConfirm, onLifecycleCancel,
    editingFieldsFor, onFieldsSaved, onFieldsCancel, t,
  } = props;

  return (
    <>
      {showNewDialog ? <NewContentTypeDialog onCreated={onNewDialogCreated} onCancel={onNewDialogCancel} t={t}
        useNewContentTypeDialogHook={hooks.useNewContentTypeDialogHook} /> : null}
      {pendingLifecycle ? (
        <LifecycleConfirmDialog
          op={pendingLifecycle.op}
          contentType={pendingLifecycle.contentType}
          onConfirm={() => onLifecycleConfirm(pendingLifecycle.op, pendingLifecycle.contentType)}
          onCancel={onLifecycleCancel}
          useLifecycleConfirmDialogHook={hooks.useLifecycleConfirmDialogHook}
          t={t}
        />
      ) : null}
      {editingFieldsFor ? (
        <EditFieldsDialog contentType={editingFieldsFor} onSaved={onFieldsSaved} onCancel={onFieldsCancel} t={t}
          useEditFieldsDialogHook={hooks.useEditFieldsDialogHook} />
      ) : null}
    </>
  );
}

export function Collections(props: CollectionsProps) {
  const { StatusLabel, publishButton, contentTypeMenuItems, ...hooks } = props;
  const {
    types, error, showNewDialog, setShowNewDialog, pendingLifecycle, setPendingLifecycle, editingFieldsFor, setEditingFieldsFor, actionError, load, runLifecycle,
    copiedKey, copyFallback, copyEmbedCode, t, locale,
  } = props.useCollectionsHook();

  if (error && !types) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!types) return <div className="jini-notice">{t({ key: "Loading content types…" })}</div>;

  // Content type keys are stable and unique (the server's own primary key for this resource), so
  // they disambiguate one row's entries link from another's — same reasoning as every other list
  // on this workstream. Each row's "Actions" menu (Edit fields/Deprecate/Reactivate/Tombstone via
  // `RowMenu`) shares this same per-row base (`${rowHandles[index]}-menu`) now that `RowMenu`
  // accepts an `agentHandle` prop — before this session it published none,
  // so its trigger and dropdown items were invisible to `page.find_elements` regardless of what this
  // file did (see `FormsList.tsx`'s identical fix).
  const rowHandles = buildAgentListHandles({ prefix: "collections-row", ids: types.map((ct) => ct.key) }
  );

  return (
    <div className="jini-page">
      {renderCollectionsHeader({ t, setShowNewDialog, publishButton })}

      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}
      {actionError ? <div className="jini-notice jini-notice-error">{actionError}</div> : null}

      {renderCollectionsTable({ types, t, rowHandles, copyEmbedCode, copiedKey, copyFallback, setEditingFieldsFor, setPendingLifecycle, runLifecycle, locale, StatusLabel, contentTypeMenuItems })}

      <CollectionsDialogs
        hooks={hooks}
        showNewDialog={showNewDialog}
        onNewDialogCreated={() => {
          setShowNewDialog(false);
          load();
        }}
        onNewDialogCancel={() => setShowNewDialog(false)}
        pendingLifecycle={pendingLifecycle}
        onLifecycleConfirm={(op, contentType) => {
          void runLifecycle(contentType, op);
          setPendingLifecycle(null);
        }}
        onLifecycleCancel={() => setPendingLifecycle(null)}
        editingFieldsFor={editingFieldsFor}
        onFieldsSaved={() => {
          setEditingFieldsFor(null);
          load();
        }}
        onFieldsCancel={() => setEditingFieldsFor(null)}
        t={t}
      />
    </div>
  );
}

function renderCollectionsHeader(
  { t, setShowNewDialog, publishButton }: Pick<CollectionsController, "t" | "setShowNewDialog"> & Pick<CollectionsListParts, "publishButton">,
) {
  return (
    <div
      className="jini-page-header"
      {...agentHandle({ handle: "collections-header" }, {
        role: "region",
        label: "Collections list header — page title and the New content type button",
      })}
    >
      <div className="jini-page-header-text">
        <p className="jini-page-kicker">{t({ key: "Content" })}</p>
        <h1 className="jini-page-title">{t({ key: "Collections" })}</h1>
        <p className="jini-page-description">{t({ key: "Content types you define, each with its own set of entries." })}</p>
      </div>
      <div className="jini-page-actions">
        {publishButton}
        <button
          onClick={() => setShowNewDialog(true)}
          {...agentHandle({ handle: "collections-new" }, { role: "button", label: "Define a new content type" })}
        >
          {t({ key: "New content type" })}
        </button>
      </div>
    </div>
  );
}

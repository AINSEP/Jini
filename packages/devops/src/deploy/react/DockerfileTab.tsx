import type { agentHandle } from "@jini-ai/core/agent-handles";
import type { DockerfileSourceSnapshot } from "../site/dockerfile.js";

import { LayersIcon } from "./deployment-visuals.js";
import type { DockerfileSourceController } from "./hooks/use-dockerfile-source.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Dockerfile tab — the repo-root `Dockerfile`'s contents, fetched from and now also written to
 * `.../system/dockerfile` (`apps/website/src/server/inbound/admin-http/routes/system/dockerfile-source.ts`).
 *
 * ## Third pass (2026-08-15) — read-only became editable
 *
 * This file's own header used to say "Read-only on purpose: there is no write route" as the reason
 * this tab could never save an edit. That stopped being true the same day, mid-session: the backend
 * gained `PUT .../system/dockerfile` (`system.write`-gated, distinct from `GET`'s `system.read`) so
 * that both a human here and the `deployment_set_dockerfile` agent tool can write the same file — but
 * only the agent side got wired up at first. The AI assistant could edit the Dockerfile through its
 * tool; the human owner, looking at this exact screen, could not. This pass closes that gap: the
 * `<pre><code>` viewer is now a `<textarea>` bound to `useDockerfileSource`'s `draft`, with a Save
 * button next to Copy/Download.
 *
 * The "no Dockerfile yet" empty state gained the same editor rather than staying a dead end — the
 * write route creates the file if it doesn't exist (`writeDockerfileSource`'s own doc), so a human
 * typing a fresh Dockerfile into this screen and clicking Save is exactly as valid as the agent tool
 * calling `deployment_set_dockerfile` on a workspace with no Dockerfile yet. The illustrated
 * "Not generated yet" block from the second pass stays exactly as it was, ahead of the editor, rather
 * than being replaced by it — this tab still owes the reader an honest "this doesn't exist yet"
 * before handing them a blank box to fill in.
 *
 * ## Fourth pass (2026-08-15, same day) — a save conflict gets its own surface, not a generic error
 *
 * `useDockerfileSource`'s `save()` now sends `snapshot`'s etag as `If-Match`, so a save based on
 * stale contents (a human here and the AI assistant's `deployment_set_dockerfile` tool can both
 * write this same file — Terra audit finding C5) is refused rather than silently overwriting the
 * other write. That refusal reaches this component as `saveConflict`, deliberately kept separate
 * from `saveError` (see `use-dockerfile-source.hooks.ts`'s own header) — `DockerfileEditorCard`
 * below renders it as its OWN block, ahead of (and instead of) the plain error paragraph, showing
 * the real current server contents next to the operator's still-untouched `draft` and a button that
 * calls `reloadAfterConflict` to refresh `snapshot`'s etag without discarding that draft.
 *
 * Saving does not build, validate, or deploy anything — same as before, just now said twice: once in
 * the pre-existing "Building is a terminal command…" footer line (still true, still there), and once
 * in a new second line that names the Save button specifically, since a reader who has just watched
 * this tab grow a Save button has a new, reasonable reason to wonder whether it also rebuilds.
 *
 * `useDirtyGuard` is wired for the one form of "leaving with unsaved changes" this tab can protect
 * against on its own — closing or reloading the browser tab (`beforeunload`). It is deliberately NOT
 * wired to `TabBar`'s own tab-switch or to sidebar navigation: `Deployment.tsx`'s `deploymentTabPanel`
 * unmounts this component when the operator switches to another of the five tabs, same as leaving any
 * other screen in this admin, and NO editor screen in this app guards THAT kind of navigation today
 * (only in-app "back" links some screens wire individually) — extending that pattern app-wide is a
 * separate, larger decision than "make this one tab editable."
 */
export interface DockerfileTabProps {
  useDockerfileSourceHook(): DockerfileSourceController;
  download(required: { contents: string }, optional?: Record<string, never>): void;
  dockerfileLineCountLabel(required: { translate: Translate; count: number }, optional?: Record<string, never>): string;
  agentHandle: typeof agentHandle;
  lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true };
}

/** How many lines the editor's current draft has. A trailing newline is not a line, hence the
 *  `trimEnd` — otherwise every file that ends the way text files should would report one line too
 *  many. Counts `draft`, not the last-saved `snapshot.contents`, so the count tracks what the
 *  operator is actually looking at, including unsaved edits.
 *  @complexity O(n) in the draft's length, once per render of an already-in-memory string. */
function countLines({ draft }: { draft: string }, _options = {}): number {
  if (!draft) return 0;
  return draft.trimEnd().split("\n").length;
}

/** The "not generated yet" illustrated block — `snapshot.exists === false`. Unchanged from the
 *  second pass: still a composed block rather than the default `.empty-state`'s two centered grey
 *  sentences, because this remains a durable, truthful state of the product ("nothing here yet"),
 *  not a transient one. What changed is that this block no longer speaks for the whole empty case by
 *  itself — `dockerfileTabBody` now renders the editor card right below it, so the reader's very
 *  next move can be "write one." */
function DockerfileEmptyState({ t, agentHandle, lineIcon }: Pick<DockerfileTabProps, "agentHandle" | "lineIcon"> & { t: Translate }) {
  return (
    <div
      className="card"
      {...agentHandle({ handle: "deployment-dockerfile-empty" }, {
        role: "region",
        label: "No Dockerfile exists yet at the repo root — write one in the editor below to create it",
      })}
    >
      <div className="deployment-empty">
        <span className="deployment-empty-mark">
          <LayersIcon size={22} lineIcon={lineIcon} />
        </span>
        {/* A real `<h2>` for the same reason `@jini-ai/devops/deploy/react` HistoryTab's own empty state documents: in this
            state it is the tab's only heading. */}
        <h2 className="deployment-empty-title">{t("No Dockerfile yet")}</h2>
        <p className="deployment-empty-body">
          {t("No Dockerfile exists at the repo root yet. Once one is added, its contents will appear here.")}
        </p>
      </div>
    </div>
  );
}

/** The save-conflict banner (`412`, Terra audit finding C5) — pulled out of `DockerfileEditorCard`
 *  on its own so that component's own cognitive-complexity budget doesn't also have to carry this
 *  block's nested exists-vs-deleted branch on top of everything else it already renders
 *  conditionally (unsaved pill, saved confirmation, empty-state reason, Save/Copy/Download disabled
 *  states). Renders unconditionally once called — the caller (`DockerfileSaveStatus` below) decides
 *  WHETHER to render it at all. */
function DockerfileConflictBanner({
  conflict,
  onReload,
  t,
  agentHandle,
}: Pick<DockerfileTabProps, "agentHandle"> & {
  conflict: { exists: boolean; contents: string | null };
  onReload: () => void;
  t: Translate;
}) {
  return (
    <div
      className="notice error"
      role="alert"
      {...agentHandle({ handle: "deployment-dockerfile-conflict" }, {
        role: "status",
        label: "Shows that the Dockerfile changed on the server since it was last loaded, with the current contents to compare against",
      })}
    >
      <p>{t("Someone else saved a different version of this Dockerfile while you were editing — your changes below were NOT saved.")}</p>
      {conflict.exists ? (
        <>
          <p>{t("Its current contents on the server are:")}</p>
          <pre className="deployment-dockerfile-conflict-contents">{conflict.contents}</pre>
        </>
      ) : (
        <p>{t("It was deleted on the server.")}</p>
      )}
      <p>{t("Your own edits below are untouched. Compare them against the current contents above, reconcile by hand, then Save again.")}</p>
      <button
        type="button"
        onClick={onReload}
        {...agentHandle({ handle: "deployment-dockerfile-conflict-reload" }, {
          role: "button",
          label: "Reloads the current version from the server so the next Save is checked against it — does not discard your own edits",
        })}
      >
        {t("Load the current version")}
      </button>
    </div>
  );
}

/** Whichever ONE status banner belongs above the textarea, if any: a save conflict takes
 *  precedence over — and renders INSTEAD OF — a generic save error, even though `saveMutation`'s own
 *  error state briefly held the same rejection (see `use-dockerfile-source.hooks.ts`'s header for
 *  why the hook already resets that error state itself on a conflict, so in practice the two are
 *  never simultaneously set; this precedence is the belt to that suspenders). A flat dispatch
 *  function rather than a ternary chain inline in `DockerfileEditorCard`'s own JSX, same
 *  complexity-gate reasoning `dockerfileTabBody` already documents for its own two-shape dispatch. */
function DockerfileSaveStatus({
  saveConflict,
  saveError,
  onReloadAfterConflict,
  t,
  agentHandle,
}: Pick<DockerfileTabProps, "agentHandle"> & {
  saveConflict: { exists: boolean; contents: string | null } | null;
  saveError: string | null;
  onReloadAfterConflict: () => void;
  t: Translate;
}) {
  if (saveConflict) return <DockerfileConflictBanner conflict={saveConflict} onReload={onReloadAfterConflict} t={t} agentHandle={agentHandle} />;
  if (saveError)
    return (
      <p
        className="save-error"
        role="alert"
        {...agentHandle({ handle: "deployment-dockerfile-save-error" }, {
          role: "status",
          label: "Shows the error message when saving the Dockerfile failed",
        })}
      >
        {saveError}
      </p>
    );
  return null;
}

interface DockerfileEditorState extends Pick<DockerfileTabProps, "download" | "dockerfileLineCountLabel" | "agentHandle" | "lineIcon"> {
  draft: string;
  setDraft: (value: string) => void;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  saveConflict: { exists: boolean; contents: string | null } | null;
  saved: boolean;
  copied: boolean;
  onCopy: () => void;
  onSave: () => void;
  onReloadAfterConflict: () => void;
  t: Translate;
}

/** The editable Dockerfile card: Copy/Download/Save actions, the line count, an "unsaved changes"
 *  pill, and the textarea itself — the one card that renders in BOTH the "exists" and "doesn't exist
 *  yet" cases (see `dockerfileTabBody`), since the write route makes both cases the same underlying
 *  action (replace the file's bytes with `draft`). */
function DockerfileEditorCard({
  exists,
  draft,
  setDraft,
  isDirty,
  saving,
  saveError,
  saveConflict,
  saved,
  copied,
  onCopy,
  onSave,
  onReloadAfterConflict,
  t,
  download, dockerfileLineCountLabel, agentHandle,
}: DockerfileEditorState & { exists: boolean }) {
  // Copy/Download act on `draft` — see `use-dockerfile-source.hooks.ts`'s header for why the copy
  // handler itself reads `draft` rather than the last-saved `snapshot`. There is nothing worth
  // copying or downloading out of an empty, untouched box, so both are disabled on a blank draft
  // rather than handing the operator an empty file with no feedback about why.
  const hasContent = draft.length > 0;

  return (
    <div
      className="card"
      {...agentHandle({ handle: "deployment-dockerfile-editor-card" }, {
        role: "region",
        label: "Dockerfile editor — view, edit, copy, download and save the repo-root Dockerfile's contents",
      })}
    >
      <div className="card-head">
        <h2 className="card-title">{t("Dockerfile")}</h2>
        <DockerfileEditorActions draft={draft} hasContent={hasContent} isDirty={isDirty} saved={saved} copied={copied} saving={saving} onCopy={onCopy} onSave={onSave} t={t} download={download} dockerfileLineCountLabel={dockerfileLineCountLabel} agentHandle={agentHandle} />
      </div>
      <div className="deployment-card-body">
        {!exists ? (
          <p className="deployment-action-reason">{t("No Dockerfile exists yet. Write one below, then save to create it.")}</p>
        ) : null}
        <DockerfileSaveStatus saveConflict={saveConflict} saveError={saveError} onReloadAfterConflict={onReloadAfterConflict} t={t} agentHandle={agentHandle} />
        <textarea
          className="deployment-dockerfile-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          translate="no"
          aria-label={t("Dockerfile contents")}
          {...agentHandle({ handle: "deployment-dockerfile-textarea" }, {
            role: "field",
            label: "The Dockerfile's contents, editable — changes are not saved until Save is clicked",
          })}
        />
        <p className="deployment-action-reason">
          {t("Building is a terminal command (docker build …), not a button here.")}
        </p>
        <p className="deployment-action-reason">
          {t("Saving here only replaces the file's contents — it does not build or deploy anything.")}
        </p>
      </div>
    </div>
  );
}

function DockerfileEditorActions({ draft, hasContent, isDirty, saved, copied, saving, onCopy, onSave, t, download, dockerfileLineCountLabel, agentHandle }: Pick<DockerfileEditorState, "draft" | "isDirty" | "saved" | "copied" | "saving" | "onCopy" | "onSave" | "t" | "download" | "dockerfileLineCountLabel" | "agentHandle"> & { hasContent: boolean }) {
  return (
        <div className="card-head-actions">
          <span className="deployment-provider-cost">{dockerfileLineCountLabel({ translate: t, count: countLines({ draft }) })}</span>
          {isDirty ? (
            <span
              className="status status-warning"
              {...agentHandle({ handle: "deployment-dockerfile-unsaved" }, {
                role: "status",
                label: "Indicates the Dockerfile draft has unsaved changes",
              })}
            >
              {t("Unsaved changes")}
            </span>
          ) : null}
          {saved ? (
            <span
              className="save-ok"
              {...agentHandle({ handle: "deployment-dockerfile-saved" }, {
                role: "status",
                label: "Confirms the Dockerfile was just saved successfully",
              })}
            >
              {t("Saved")}
            </span>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={onCopy}
            disabled={!hasContent}
            {...agentHandle({ handle: "deployment-dockerfile-copy" }, {
              role: "button",
              label: "Copy the Dockerfile's current draft contents to the clipboard",
            })}
          >
            {/* `aria-live="polite"` so the label's swap to "Copied!" is announced — an action whose
                only feedback is a silent visual change is invisible to a screen-reader user. */}
            <span aria-live="polite">{copied ? t("Copied!") : t("Copy")}</span>
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download({ contents: draft })}
            disabled={!hasContent}
            {...agentHandle({ handle: "deployment-dockerfile-download" }, {
              role: "button",
              label: "Download the Dockerfile's current draft contents as a file named Dockerfile",
            })}
          >
            {t("Download")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            {...agentHandle({ handle: "deployment-dockerfile-save" }, {
              role: "button",
              label:
                "Save the Dockerfile's current draft — creates the file if it doesn't exist yet. " +
                "Does not build or deploy anything.",
            })}
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
  );
}

export function DockerfileTab(props: DockerfileTabProps) {
  const { useDockerfileSourceHook, download, dockerfileLineCountLabel, agentHandle, lineIcon } = props;
  const {
    snapshot,
    draft,
    setDraft,
    isDirty,
    error,
    saving,
    saveError,
    saveConflict,
    reloadAfterConflict,
    saved,
    copied,
    copy,
    save,
    t,
  } = useDockerfileSourceHook();

  if (error && !snapshot)
    return (
      <div
        className="notice error"
        {...agentHandle({ handle: "deployment-dockerfile-load-error" }, {
          role: "status",
          label: "Shows the error message when loading the Dockerfile failed",
        })}
      >
        {error}
      </div>
    );
  if (!snapshot) return <div className="notice">{t("Loading Dockerfile…")}</div>;

  return (
    <div className="deployment-tab">
      {error ? (
        <div
          className="notice error"
          {...agentHandle({ handle: "deployment-dockerfile-load-error" }, {
            role: "status",
            label: "Shows the error message when loading the Dockerfile failed",
          })}
        >
          {error}
        </div>
      ) : null}
      {dockerfileTabBody(snapshot, {
        draft,
        setDraft,
        isDirty,
        saving,
        saveError,
        saveConflict,
        saved,
        copied,
        onCopy: () => void copy(),
        onSave: () => void save(),
        onReloadAfterConflict: () => void reloadAfterConflict(),
        t,
        download, dockerfileLineCountLabel, agentHandle, lineIcon,
      })}
    </div>
  );
}

/** Dispatches the loaded snapshot's two shapes (missing vs. present) as a flat function rather than
 *  a ternary inline in `DockerfileTab`'s own JSX — same complexity-gate reasoning
 *  `Deployment.tsx`'s `deploymentTabPanel` documents. The editor card renders in BOTH shapes now (see
 *  `DockerfileEditorCard`'s own doc); only the illustrated empty-state block is conditional. */
function dockerfileTabBody(
  snapshot: DockerfileSourceSnapshot,
  editor: DockerfileEditorState
) {
  return (
    <>
      {!snapshot.exists ? <DockerfileEmptyState t={editor.t} agentHandle={editor.agentHandle} lineIcon={editor.lineIcon} /> : null}
      <DockerfileEditorCard exists={snapshot.exists} {...editor} />
    </>
  );
}

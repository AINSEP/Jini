import type { FormEvent } from "react";
import type { AdminWorkspaceResponse } from "@jini-ai/core/contracts/site/cms-workspace";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { formatTimestamp, type Translate } from "@jini-ai/core/text";

import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
import { isWorkspaceDirty } from "./rules.js";
/**
 * @file "Workspace" admin screen (SPEC-044) — the `/admin/workspace` route — markup only.
 *
 * Mirrors the host roles screen's fetch/loading/error/form shape. Shows the current (single, v1)
 * workspace's `name`/`slug`/`createdAt` and an editable rename form (REQ-04). No list/create UI —
 * v1 always has exactly one workspace, addressable only through the caller's own boot-wired
 * `deps.workspaceId` (see the host's feature spec's Architectural Finding section); `api.getWorkspace()`
 * fetches that one record directly rather than listing then picking the first.
 *
 * The "Delete workspace" control is REQ-07's deliberate choice: present, not hidden, but always
 * disabled with an explanatory notice — `DELETE_WORKSPACE` always refuses in v1 (INV-03, a real
 * guard, not a stub), so a live, clickable button here would just be a guaranteed-failing round
 * trip; omitting the control entirely would look like the capability doesn't exist rather than
 * "exists, guarded, not reachable yet."
 *
 * State, the fetch, and save live in the host's workspace hook, which reaches this screen as the
 * REQUIRED `useWorkspaceHook` prop; the error-code overrides stay with the host (its copy) and the
 * dirty-form derivation lives in `rules.ts`. The delete notice's copy is the host's too
 * (`deletion`): why deletion is unavailable is a statement about the host's deployment.
 *
 * Web-design pass (2026-08-05): the id/createdAt pair below used to render as a full bordered
 * list table with exactly two rows — sparse next to every real multi-row `.list-table` elsewhere
 * in this app, and reading as "table for table's sake" for a two-field read-only summary. Swapped
 * for `.jini-settings-layer-grid`/`.jini-settings-layer-cell` — the same compact key/value chip idiom
 * the host taxonomy screen's `TermDetailPanel` already uses for its own small Status/Parent/Version set.
 */
/** Everything the screen renders from — what the host's workspace hook returns. */
export interface WorkspaceController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  workspace: AdminWorkspaceResponse | null;
  error: string | null;
  name: string;
  setName: (name: string) => void;
  slug: string;
  setSlug: (slug: string) => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
  onSave: (e: FormEvent) => Promise<void>;
  /** Bound translator — `key` already resolved against the caller's locale. */
  t: Translate;
  /** Raw resolved locale, for host subcomponents that take one. */
  locale: string;
}

export interface WorkspaceProps {
  /** The host's workspace controller hook (fetch, rename draft, save). REQUIRED: this screen owns
   *  no I/O and no locale resolution of its own. */
  useWorkspaceHook: () => WorkspaceController;
  /** The host's copy for the always-disabled delete control — the notice under the "Delete
   *  workspace" heading and the button's tooltip — as keys this screen resolves through the
   *  controller's `t`, exactly like every other label here. */
  deletion: { lead: string; unavailableTitle: string };
  /**
   * Whether to render this screen's own `.page-header` (kicker "Administration", the "Workspace"
   * `<h1>`, and the identity-summary description). Defaults to `true` (this component's original,
   * standalone-route rendering — unchanged for every other caller).
   *
   * The host's settings screen passes `false`: mounted as that screen's `"workspace"` tab, `Workspace` sits
   * *under* `SettingsDialogShell`'s own chrome header, which already renders the tab's `title` and
   * `subtitle` (the host settings screen's tab entry sets both to this same kicker-free "Workspace" title
   * and identity-summary sentence — see that entry's own comment). Rendering this header too used
   * to say "Workspace" and the same description a second time directly underneath the shell's own
   * — the exact `showTitle`-style seam the host's external-MCP settings panel already uses for the
   * identical problem on the Providers screen (see that component's own `showTitle` doc), matched
   * here rather than a CSS override: a `display: none` would leave "Workspace" in the DOM and the
   * accessibility tree, so a screen reader would still announce the title twice even though only
   * one copy is visible.
   *
   * Suppresses the WHOLE header block, not just the `<h1>` the way `showTitle` does on
   * that panel — its own subtitle is unique content with no shell
   * equivalent, so only its title is redundant; here all three pieces (kicker, title, description)
   * restate something the shell's chrome already shows once this is a tab, not a standalone page,
   * so all three go together. No kicker survives on its own either: no other `SettingsUi` tab shows
   * one, since the shell's single "Settings" kicker already plays that role for all of them.
   */
  showPageHeader?: boolean;
}

/** The rename form's own status pair — a save error, or a "Saved." confirmation once the form is
 *  no longer dirty. Split out of `Workspace` as a top-level function per the complexity-ceiling
 *  brief's extraction rule. */
function WorkspaceFormStatus(props: { t: Translate; saveError: string | null; saved: boolean; dirty: boolean }) {
  const { t, saveError, saved, dirty } = props;
  return (
    <>
      {saveError ? <span className="jini-save-error">{saveError}</span> : null}
      {saved && !dirty ? <span className="jini-save-success">{t("Saved.")}</span> : null}
    </>
  );
}

/** The always-disabled delete control and the host's explanation of why. Split out of `Workspace`
 *  as a top-level function per the complexity-ceiling brief's extraction rule. */
function WorkspaceDeleteCard({ t, deletion }: { t: Translate; deletion: WorkspaceProps["deletion"] }) {
  // `.jini-card`/`.jini-card-title` (the host stylesheet), the same primitive Deployment's Overview tab
  // uses for its own sections — not a bare `<h2>`, which renders at the UA-default 24px against
  // `.page-title`'s 26.4px (measured live: 91% of it, different font family, a stray 19.92px
  // margin) and reads as a second page starting rather than a section of this one. `.jini-card-danger`
  // (new, small, generically reusable) adds the same red-left-border signal `.notice.error`/
  // `.notice.warning` already use, for a section that is destructive content rather than a
  // message.
  return (
    <div className="jini-card jini-card-danger">
      <h2 className="jini-card-title">{t("Delete workspace")}</h2>
      <p className="jini-card-lead">
        {t(deletion.lead)}
      </p>
      {/* `.jini-btn-danger` at rest, not just on some future enabled state — genuinely destructive by
          nature even while `:disabled`; staying `.jini-btn-danger` means this doesn't quietly read as a
          neutral action if it's ever wired live. Its disabled state now has its own rule
          (`.jini-btn-danger:disabled`, the host stylesheet) — verified live via getComputedStyle that without it,
          `button:disabled`'s primary-tinted fill (out-specifying `.jini-btn-danger`'s own background/
          color) painted a peach fill behind a red border and near-white text, reading as broken
          rather than deliberately unavailable. */}
      <button
        type="button"
        className="jini-btn-danger"
        disabled
        title={t(deletion.unavailableTitle)}
        {...agentHandle({ handle: "workspace-delete" }, { role: "button", label: "Delete workspace (not available — only one workspace exists)" })}
      >
        {t("Delete workspace")}
      </button>
    </div>
  );
}

export function Workspace(props: WorkspaceProps) {
  const { deletion, showPageHeader = true } = props;
  // Called through `props` because the host's hook is a required prop, never a default.
  const { workspace, error, name, setName, slug, setSlug, saving, saveError, saved, onSave, t } = props.useWorkspaceHook();

  // The host stylesheet scopes the `jini-*` notice look under `.jini-page`, so the two early
  // answers keep the page wrapper.
  if (error) return <div className="jini-page jini-workspace-page"><div className="jini-notice jini-notice-error">{error}</div></div>;
  if (!workspace) return <div className="jini-page jini-workspace-page"><div className="jini-notice">{t("Loading workspace…")}</div></div>;

  const dirty = isWorkspaceDirty({ workspace, name, slug });

  return (
    // `.jini-workspace-page` caps measure (the host stylesheet) — this is a single-column settings screen, not
    // a table/dashboard, and `.jini-page` itself carries no max-width anywhere in the app (would affect
    // every other screen using it), so the cap lives on a scoped wrapper class instead.
    <div className="jini-page jini-workspace-page">
      {showPageHeader ? (
        <div className="jini-page-header">
          <div className="jini-page-header-text">
            <p className="jini-page-kicker">{t("Administration")}</p>
            <h1 className="jini-page-title">{t("Workspace")}</h1>
            <p className="jini-page-description">{t("This site's identity — its name, URL slug, and creation date.")}</p>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSave} className="jini-notice jini-integrations-form jini-form-measure">
        <WorkspaceFormStatus t={t} saveError={saveError} saved={saved} dirty={dirty} />
        <label>
          {t("Name")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            {...agentHandle({ handle: "workspace-name" }, { role: "field", label: "This workspace's name" })}
          />
        </label>
        <label>
          {t("Slug")}
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            {...agentHandle({ handle: "workspace-slug" }, { role: "field", label: "This workspace's URL slug" })}
          />
        </label>
        <button
          type="submit"
          disabled={saving || !dirty}
          {...agentHandle({ handle: "workspace-save" }, { role: "button", label: "Save the workspace's name and slug" })}
        >
          {saving ? t("Saving…") : t("Save changes")}
        </button>

        {/* `.jini-workspace-identity-grid` (the host stylesheet) groups these with the rename form above them —
            previously a bare `.jini-settings-layer-grid` sitting on the page by itself below the form's
            own card, reading as an unrelated second block rather than "more facts about this same
            workspace." Same divider idiom `.deployment-route-note`/`.settings-scope-editor` already
            use for a sub-section inside one container. */}
        <div className="jini-settings-layer-grid jini-workspace-identity-grid">
          <div className="jini-settings-layer-cell">
            <span className="jini-settings-layer-label">{t("Workspace ID")}</span>
            <span>{workspace.id}</span>
          </div>
          <div className="jini-settings-layer-cell">
            <span className="jini-settings-layer-label">{t("Created")}</span>
            {/* Raw ISO-8601 (`2026-04-06T00:00:00.000Z`) leaked to the screen unformatted — the
                exact class of bug the shared timestamp formatter's own file header describes fixing at ~a
                dozen other call sites; this one was missed. Same shared helper, same YYYY-MM-DD
                HH:MM display, no new formatting logic. */}
            <span>{formatTimestamp({ iso: workspace.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE })}</span>
          </div>
        </div>
      </form>

      <WorkspaceDeleteCard t={t} deletion={deletion} />
    </div>
  );
}

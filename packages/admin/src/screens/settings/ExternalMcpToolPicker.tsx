import { agentHandle } from "@jini-ai/core/agent-handles";
import { SeeMore, useT } from "../../react/kit.js";


import {
  describeToolCount,
  describeToolRowBadges,
  describeToolRowLock,
  toolPickerHandle,
  useToolPickerFilter,
  useToolRowHandles,
  type ToolPickerFilter,
  type VisibleToolRow,
} from "./ExternalMcpToolPicker.hooks.js";
import { displayToolDescription, isToolRowLocked, toolPickerFooterLocks, type ToolPickerRow } from "./external-mcp-tool-picker-rules.js";
import type { UseWiredExternalMcpToolPicker } from "./hooks/use-external-mcp-tool-picker.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The write-tool picker — Phase 4 of
 * `ADS-memory/reports/pipeline/external-mcp-write-tools/implementation-outline.md`, named there and
 * promised by name in two shipping comments (`use-external-mcp.hooks.ts`'s `testSource`,
 * `external-mcp-i18n.ts`'s header) since Phase 2C translated its copy.
 *
 * ## What this replaces, and what it deliberately does not
 *
 * The roster card's two free-text fields (`ALLOWED TOOLS`, `ALLOWED TO MAKE CHANGES`) require an
 * operator to already know a remote's tool names and to type them without a typo — on the live
 * higgsfield connection that is 7 names chosen from 101, and a misspelling is silently reported as
 * `allowlistedButAbsent` rather than refused. This picker lists what the server actually advertises
 * and writes the same two fields back.
 *
 * It is a superset affordance, NOT a replacement (§3.5). The text fields stay, on the Connection
 * tab, because they are the failure path: a probe failure, an unreachable server, or a `stdio`
 * connection (which D-7 keeps out of the v1 probe entirely, to avoid spawning a child process in
 * the web server) leaves no advertised list to pick from, and an operator must still be able to
 * type. The picker degrades to a stated reason and never removes the other route.
 *
 * ## Two grants, and why one of them is not always rendered
 *
 * The gate reads two lists, and a name on the write list alone grants nothing — `trust.ts`'s
 * `writeAllowedButNotAllowlisted` is a named drift condition the existing banner exists to report.
 * So each row carries an allowlist checkbox, and a "may write" checkbox only for a tool that
 * DECLARES it writes. A read-only tool has no write to grant, and a silent one has not told us it
 * has: rendering the toggle anyway would invite a grant with no meaning at the gate. Both setters
 * in `external-mcp-tool-picker-rules.ts` keep the two lists consistent in both directions, so the
 * broken combination is unreachable from this control rather than merely discouraged.
 *
 * ## Colour is declared, never inherited
 *
 * Every control here sets `color` explicitly in `styles/external-mcp-tool-picker.css`. This app's
 * global `button` reset (`styles.css:279`) supplies `color: var(--primary-ink)` — near-white — and
 * a component stylesheet that declares `background` and `border` but not `color` loses that one
 * property to the host reset while winning the others, which is exactly how the sibling card's
 * Edit/Save/Cancel pills shipped as invisible text on a light panel (fixed in Jini `b82cbe95`; a
 * prior instance is documented at `settings-dialog.css:851-865`). A `getByText` assertion passes
 * throughout that failure, so legibility here is pinned against the stylesheet source instead.
 *
 * ## Layout (2026-10-13 redesign, owner: "the UI is ugly")
 *
 * Toolbar (search, select all/none, Refresh) on top, the list as the one scroller, and one footer
 * holding the count, the restart note and Cancel/Save. The count and the footnote used to sit in two
 * different places with Refresh/Cancel/Save beside the count and the modal's own Close as a second
 * button cluster; now there is one action area. Each row is checkbox + name + badges on one line, a
 * one-line description that expands in place, and "Allow changes" (the write grant, formerly a
 * bare "may write" checkbox that floated under the description) at the row's right edge.
 */

/** One tool. A real `<label>` wraps each checkbox rather than an `aria-label` — `agentHandle`'s
 *  `label` emits `data-agent-label` and supplies no accessible name at all, the same reasoning
 *  `ExternalMcpAdmissionsBanner`'s own row documents. Split out of the list `.map()` for this app's
 *  9/9 complexity ceiling, which scores a branch inside an inline callback with a nesting penalty. */
function ToolPickerRowItem(props: {
  row: ToolPickerRow;
  handle: string;
  t: Translate;
  productVars: Readonly<{ productName: string }>;
  onEnabled: (remoteName: string, enabled: boolean) => void;
  onMayWrite: (remoteName: string, mayWrite: boolean) => void;
}) {
  const { row, handle, t, productVars, onEnabled, onMayWrite } = props;
  const locked = isToolRowLocked(row);
  const lockReason = describeToolRowLock({ row, t, productVars });
  const badges = describeToolRowBadges({ row, t });

  return (
    <li className="jini-external-mcp-tool-row" data-locked={locked || undefined}>
      <div className="jini-external-mcp-tool-title">
        <label className="jini-external-mcp-tool-enable">
          <input
            type="checkbox"
            checked={row.enabled}
            disabled={locked}
            {...agentHandle({ handle }, { role: "checkbox", label: `Enable the tool ${row.remoteName}` })}
            onChange={(event) => onEnabled(row.remoteName, event.target.checked)}
          />
          <span className="jini-external-mcp-tool-name">{row.remoteName}</span>
        </label>
        {badges.map((badge) => (
          <span key={badge.label} className="jini-external-mcp-tool-badge" data-tone={badge.tone}>
            {badge.label}
          </span>
        ))}
      </div>

      {/* The write grant — only for a tool that declares it writes (see this file's header). A
          locked row renders no write control either: its allowlist grant is refused outright, so a
          write grant on top of it would be doubly meaningless. Sits at the row's right edge so it
          reads as a second switch on THIS tool, not a stray checkbox under the description. */}
      {row.writeDeclared && !locked ? (
        <label className="jini-external-mcp-tool-write">
          <input
            type="checkbox"
            checked={row.mayWrite}
            {...agentHandle({ handle: `${handle}-write` }, { role: "checkbox", label: `Allow ${row.remoteName} to make changes` })}
            onChange={(event) => onMayWrite(row.remoteName, event.target.checked)}
          />
          <span>{t("Allow changes")}</span>
        </label>
      ) : null}

      {/* `displayToolDescription` strips the `[EXTERNAL TOOL — provided by '...']` wrapper for
          THIS RENDER ONLY — `row.description` itself keeps carrying it, since that same string
          (via `describeRemoteToolSurface`/`describeFederatedTool`) is what actually reaches the
          model; see that function's own doc. `SeeMore` clamps it to ONE line (2026-10-13 redesign;
          was 3) so a 157-row list scans as names, and the toggle expands it in place. */}
      {row.description ? (
        <SeeMore
          lines={1}
          className="jini-external-mcp-tool-description-wrap"
          textClassName="jini-external-mcp-tool-description"
          toggleClassName="jini-external-mcp-tool-description-toggle"
          toggleAriaLabel={`See more of ${row.remoteName}'s description`}
          agentHandle={`${handle}-description-toggle`}
        >
          {displayToolDescription({ description: row.description })}
        </SeeMore>
      ) : null}

      {lockReason ? <p className="jini-external-mcp-tool-lock">{lockReason}</p> : null}
    </li>
  );
}

/** Search, select all/none, and Refresh. Search and the bulk buttons only exist once there are rows
 *  to act on; Refresh is always there, because it is also how a failed probe is retried. Refresh is
 *  a quiet ghost button: the one primary action in this dialog is Save, in the footer. */
function ToolPickerToolbar(props: {
  base: string;
  filter: ToolPickerFilter | null;
  saving: boolean;
  refreshing: boolean;
  t: Translate;
  tUi: ReturnType<typeof useT>;
  onRefresh: () => void;
}) {
  const { base, filter, saving, refreshing, t, tUi, onRefresh } = props;
  return (
    <div className="jini-external-mcp-tool-toolbar">
      {filter ? (
        <>
          <input
            type="search"
            className="jini-external-mcp-tool-search"
            placeholder={t("Search tools")}
            aria-label={t("Search tools")}
            value={filter.query}
            onChange={(event) => filter.setQuery(event.target.value)}
            {...agentHandle({ handle: `${base}-search` }, { role: "field", label: "Filter this server's tools by name or description" })}
          />
          <div className="jini-external-mcp-tool-bulk">
            <button
              type="button"
              className="btn-ghost"
              disabled={!filter.canSelectAll || saving}
              onClick={() => filter.selectVisible(true)}
              {...agentHandle({ handle: `${base}-select-all` }, { role: "button", label: "Enable every tool currently shown" })}
            >
              {t("Select all")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!filter.canSelectNone || saving}
              onClick={() => filter.selectVisible(false)}
              {...agentHandle({ handle: `${base}-select-none` }, { role: "button", label: "Disable every tool currently shown" })}
            >
              {t("Select none")}
            </button>
          </div>
        </>
      ) : null}
      <button
        type="button"
        className="btn-ghost jini-external-mcp-tool-refresh"
        {...agentHandle({ handle: `${base}-refresh` }, { role: "button", label: "Re-read this server's advertised tool list" })}
        onClick={onRefresh}
        disabled={refreshing || saving}
      >
        {refreshing ? tUi("Refreshing…") : tUi("Refresh")}
      </button>
    </div>
  );
}

/** The one action area: the count and the restart note on the left, Cancel and Save on the right.
 *  Cancel closes the dialog (the draft lives in this component, so closing discards it); see
 *  `toolPickerFooterLocks` for why only an in-flight save may disable it. Its own component for the same complexity-ceiling reason as {@link ToolPickerRowItem}; it also
 *  keeps the count — the one thing the owner asked to be legible without scrolling a 157-row list —
 *  outside the scroll container, pinned under it. */
function ToolPickerFooter(props: {
  base: string;
  countLabel: string;
  zero: boolean;
  dirty: boolean;
  saving: boolean;
  t: Translate;
  tUi: ReturnType<typeof useT>;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { base, countLabel, zero, dirty, saving, t, tUi, onSave, onCancel } = props;
  const locks = toolPickerFooterLocks({ dirty, saving });
  return (
    <div className="jini-external-mcp-tool-foot">
      <div className="jini-external-mcp-tool-foot-text">
        <p
          className="jini-external-mcp-tool-count"
          data-zero={zero || undefined}
          {...agentHandle({ handle: `${base}-count` }, { role: "status", label: "How many of this server's tools are enabled" })}
        >
          {countLabel}
        </p>
        <p className="jini-external-mcp-tool-footnote">{t("Changes here take effect when the assistant next restarts.")}</p>
      </div>
      <div className="jini-external-mcp-tool-actions">
        <button
          type="button"
          className="btn-secondary"
          {...agentHandle({ handle: `${base}-cancel` }, { role: "button", label: "Close without saving this server's tool selection" })}
          onClick={onCancel}
          disabled={locks.cancelDisabled}
        >
          {tUi("Cancel")}
        </button>
        <button
          type="button"
          className="jini-external-mcp-tool-save"
          {...agentHandle({ handle: `${base}-save` }, { role: "button", label: "Save this server's tool selection" })}
          onClick={onSave}
          disabled={locks.saveDisabled}
        >
          {tUi("Save")}
        </button>
      </div>
    </div>
  );
}

/** The list, the empty state, and the two states that are NOT an empty list — split out so the
 *  parent stays under the complexity ceiling, and so "the probe failed" and "this server genuinely
 *  advertises nothing" cannot collapse into the same rendering. An empty `<ul>` after a failed probe
 *  would read as "this server has no tools", which is a confident wrong answer. A search that hides
 *  every row says so too, rather than leaving a blank list. */
function ToolPickerBody(props: {
  loading: boolean;
  unreachable: string | null;
  total: number;
  visible: readonly VisibleToolRow[];
  t: Translate;
  tUi: ReturnType<typeof useT>;
  productVars: Readonly<{ productName: string }>;
  onEnabled: (remoteName: string, enabled: boolean) => void;
  onMayWrite: (remoteName: string, mayWrite: boolean) => void;
}) {
  const { loading, unreachable, total, visible, t, tUi, productVars, onEnabled, onMayWrite } = props;

  if (loading) {
    return (
      <div className="jini-external-mcp-tool-note" role="status">
        {tUi("Loading…")}
      </div>
    );
  }

  if (unreachable) {
    return (
      <div className="jini-external-mcp-tool-note" role="alert">
        {unreachable}
      </div>
    );
  }

  if (total === 0) {
    return <div className="jini-external-mcp-tool-note">{t("This server advertises no tools.")}</div>;
  }

  if (visible.length === 0) {
    return <div className="jini-external-mcp-tool-note">{t("No tools match your search.")}</div>;
  }

  return (
    <ul className="jini-external-mcp-tool-list">
      {visible.map(({ row, handle }) => (
        <ToolPickerRowItem key={row.remoteName} row={row} handle={handle} t={t} productVars={productVars} onEnabled={onEnabled} onMayWrite={onMayWrite} />
      ))}
    </ul>
  );
}

/** The hooks and product vars the picker needs from the host; the Tools modal threads one object through. */
export interface ExternalMcpToolPickerCollaborators {
  useExternalMcpDriftCopyHook: () => Translate;
  useTHook: typeof useT;
  useWiredExternalMcpToolPickerHook: UseWiredExternalMcpToolPicker;
  useToolRowHandlesHook: typeof useToolRowHandles;
  useToolPickerFilterHook: typeof useToolPickerFilter;
  /** The product-name vars the lock reason's `{productName}` token interpolates (product copy stays in the host). */
  productVars: Readonly<{ productName: string }>;
}

export interface ExternalMcpToolPickerProps {
  /** The roster row's own id — the probe route's path parameter. */
  serverId: string;
  /** Whether the operator is looking at this server's Tools tab. Gates the outbound probe. */
  active: boolean;
  /** Whether the CONNECTION itself is switched on. A carefully-picked roster on a disabled
   *  connection loads nothing, and the card's own toggle is one tab away, so the state is restated
   *  here rather than left invisible while someone works. */
  connectionEnabled: boolean;
  allowedToolNames: string | undefined;
  writeAllowedToolNames: string | undefined;
  saving: boolean;
  onSave: (fields: { allowedToolNames: string; writeAllowedToolNames: string }) => void;
  /** The footer's Cancel — the host dialog's own close. */
  onCancel: () => void;
  /** This server's card handle, from `resolveExternalMcpCardHandles` — the picker derives its own
   *  namespace from it so the two never collide. */
  cardHandle: string;
  useExternalMcpDriftCopyHook: () => Translate;
  useTHook: typeof useT;
  useWiredExternalMcpToolPickerHook: UseWiredExternalMcpToolPicker;
  /** The product-name vars the lock reason's `{productName}` token interpolates (product copy stays in the host). */
  productVars: Readonly<{ productName: string }>;
  useToolRowHandlesHook: typeof useToolRowHandles;
  useToolPickerFilterHook: typeof useToolPickerFilter;
}

export function ExternalMcpToolPicker({ useExternalMcpDriftCopyHook, useTHook, useWiredExternalMcpToolPickerHook, useToolRowHandlesHook,
  useToolPickerFilterHook, productVars, ...props }: ExternalMcpToolPickerProps) {
  const { serverId, active, connectionEnabled, allowedToolNames, writeAllowedToolNames, saving, onSave, onCancel, cardHandle } = props;
  const t = useExternalMcpDriftCopyHook();
  const tUi = useTHook();
  const picker = useWiredExternalMcpToolPickerHook({ serverId, active, allowedToolNames, writeAllowedToolNames, t });
  const base = toolPickerHandle({ cardHandle });
  const handles = useToolRowHandlesHook({ base, rows: picker.rows });
  const filter = useToolPickerFilterHook(picker.rows, { handles, base, setEnabled: picker.setEnabled });
  const countLabel = describeToolCount({ enabled: picker.enabledCount, total: picker.advertisedCount || picker.rows.length, t });

  return (
    <section className="external-mcp-tool-picker" {...agentHandle({ handle: base }, { role: "region", label: "External tool permissions" })}>
      {connectionEnabled ? null : (
        <p className="jini-external-mcp-tool-note" role="status">
          {t("This connection is switched off — these tools will not load until you enable it.")}
        </p>
      )}

      <ToolPickerToolbar
        base={base}
        filter={picker.rows.length > 0 ? filter : null}
        saving={saving}
        refreshing={picker.refreshing}
        t={t}
        tUi={tUi}
        onRefresh={picker.refresh}
      />

      <ToolPickerBody
        loading={picker.loading}
        unreachable={picker.unreachable}
        total={picker.rows.length}
        visible={filter.visible}
        t={t}
        tUi={tUi}
        productVars={productVars}
        onEnabled={picker.setEnabled}
        onMayWrite={picker.setMayWrite}
      />

      <ToolPickerFooter
        base={base}
        countLabel={countLabel}
        zero={picker.enabledCount === 0}
        dirty={picker.dirty}
        saving={saving}
        t={t}
        tUi={tUi}
        onSave={() => onSave(picker.fieldValues())}
        onCancel={onCancel}
      />
    </section>
  );
}

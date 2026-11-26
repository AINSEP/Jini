import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import type { AgentPluginRowStateControl } from "./AgentPluginRow.js";
import { MarketplaceIcon } from "./agent-plugins-visuals.js";
import type { AgentPluginInstallPort } from "../integrations/agent-plugin-ports.js";
import type { AgentPluginsProps, AgentPluginsController } from "./AgentPlugins.js";
const AGENT_PLUGINS_SPEC_URL = "https://agent-plugins.org/specification";
/**
 * The panel's non-row messages: a failed load, an unsettled first load, a refused toggle, and a
 * genuinely empty scoped list.
 *
 * Extracted from `AgentPlugins` rather than inlined as four more ternaries in the tab array — that
 * shape put `AgentPlugins` at a complexity of 13 against this repo's ceiling of 9
 * (`check:admin-complexity-drift`). The split is along a real seam: these four are all "something
 * other than a list of plugins", and none of them needs a row handle or the modal.
 *
 * `toggleError` is deliberately separate from `error` and uses `role="alert"`, not `role="status"`:
 * a load failure is the state of the screen, while a refused toggle is the outcome of something the
 * operator just did and should interrupt.
 *
 * Split from `agentPlugins` as a THIRD parameter (`visiblePlugins`) since the Downloaded/Installed
 * split (2026-09-09): `agentPlugins` (the controller's raw, unfiltered load) still answers "has the
 * load settled", but "is the list genuinely empty" now depends on the TAB's own scope — Installed
 * can read `agentPlugins.length > 0` while still being empty of ENABLED rows. Collapsing these two
 * questions back into one, as the pre-split version did, would show Installed's "loading" state
 * forever whenever Downloaded had rows but none were enabled.
 */
function AgentPluginsStatus({
  agentPlugins,
  visiblePlugins,
  error,
  toggleError,
  emptyMessage,
  t,
}: {
  agentPlugins: AgentPluginsController["agentPlugins"];
  visiblePlugins: readonly AgentPluginListRow[];
  error: AgentPluginsController["error"];
  toggleError: AgentPluginsController["toggleError"];
  emptyMessage: string;
  t: Translate;
}) {
  return (
    <>
      {error ? (
        <p className="agent-plugins-alert" role="status">
          {error}
        </p>
      ) : null}
      {!agentPlugins && !error ? <p role="status">{t("Loading Agent Plugins…")}</p> : null}
      {toggleError ? (
        <p className="agent-plugins-alert" role="alert">
          {toggleError}
        </p>
      ) : null}
      {agentPlugins && visiblePlugins.length === 0 ? (
        <p className="agent-plugins-empty-note" role="status">
          {emptyMessage}
        </p>
      ) : null}
    </>
  );
}

/** A row's Update slot, or nothing. Bundled rows never get one: they update with the host itself
 *  (`updatableAgentPluginDigest`). @complexity O(1). */
function updateSlotFor(required: { plugin: AgentPluginListRow; controller: AgentPluginsController; agentHandleBase: string; port: AgentPluginInstallPort; hooks: AgentPluginsProps["hooks"]; deps: AgentPluginsProps["deps"]; kit: AgentPluginsProps["kit"] }, _optional: Record<string, never> = {}) {
  const { plugin, controller, agentHandleBase, port, hooks, deps, kit } = required;
  const { AgentPluginUpdateSlot } = kit;
  const { updatableAgentPluginDigest } = deps;
  const expectedOldDigest = updatableAgentPluginDigest({ plugin });
  if (!expectedOldDigest) return undefined;
  return <AgentPluginUpdateSlot {...{ hooks, deps }} plugin={plugin} expectedOldDigest={expectedOldDigest} t={controller.t} agentHandleBase={agentHandleBase} onUpdated={controller.onInstalled} port={port} />;
}

/** The row list itself, scoped to whichever tab is rendering it. Rendered only when there is at
 *  least one row, so it carries no emptiness branch of its own — {@link AgentPluginsStatus} owns
 *  that case.
 *
 * `stateControlFor` replaced a direct `controller.onToggleEnabled` call here (2026-09-09): once
 * Installed kept the real switch and Downloaded traded it for a Remove/Enable action (see
 * `AgentPluginRow`'s own header on the split), the two tabs need genuinely different per-row
 * `AgentPluginRowStateControl` values, not the same callback rendered two ways — so this list asks
 * its caller (a factory, computed once per tab in `AgentPlugins`) for one, per plugin, rather than
 * hard-coding either shape itself. */
function AgentPluginList({ hooks, deps, kit,
  agentPlugins,
  controller,
  uninstallNoteId,
  stateControlFor,
  updatePort,

}: {
  agentPlugins: AgentPluginListRow[];
  controller: AgentPluginsController;
  uninstallNoteId: string;
  stateControlFor: (plugin: AgentPluginListRow) => AgentPluginRowStateControl;
  /** The upload transport an operator-installed row's Update control sends through. */
  updatePort: AgentPluginInstallPort;
} & Pick<AgentPluginsProps, "hooks" | "deps" | "kit">) {

  // Plugin ids are stable and unique, same per-row-handle derivation every other list on this
  // workstream uses (`buildAgentListHandles`). Derived from each id alone (see that function's own
  // doc), so a plugin's row handle is identical whichever tab currently lists it.
  const rowHandles = buildAgentListHandles({ prefix: "agent-plugin-row", ids: agentPlugins.map((plugin) => plugin.pluginId) }
  );

  return (
    <ul className="agent-plugin-rows">
      {agentPlugins.map((plugin, index) => (
        AgentPluginListRowView({ hooks, deps, kit, plugin, controller, uninstallNoteId, stateControlFor, updatePort, agentHandleBase: rowHandles[index]! })
      ))}
    </ul>
  );
}

/**
 * The shared shell both list tabs (Downloaded, Installed) render through: the status line(s), the
 * row list when the tab's own scope is non-empty, and the section-wide uninstall footnote plus spec
 * link. The footnote names only bundled packages as not uninstallable (2026-10-06): an uploaded one
 * can be removed through the assistant's `plugins_uninstall`, since this screen has no uninstall
 * route yet. Introduced with the Downloaded/Installed split (2026-09-09) so those two
 * tabs — which differ only in WHICH rows they scope to and their own copy, never in markup — share
 * one implementation instead of two copies that could drift.
 *
 * `visiblePlugins` is the tab's own list — every installed plugin on both tabs since 2026-09-13,
 * when Installed stopped filtering to enabled rows — `null` while the underlying load hasn't settled
 * yet, same convention `AgentPluginsController.agentPlugins` uses.
 */
function AgentPluginListPanel({ hooks, deps, kit,
  controller,
  uninstallNoteId,
  stateControlFor,
  sectionLabel,
  lede,
  emptyMessage,
  visiblePlugins,
  updatePort,

}: {
  controller: AgentPluginsController;
  uninstallNoteId: string;
  stateControlFor: (plugin: AgentPluginListRow) => AgentPluginRowStateControl;
  updatePort: AgentPluginInstallPort;
  sectionLabel: string;
  lede: string;
  emptyMessage: string;
  visiblePlugins: AgentPluginListRow[] | null;
} & Pick<AgentPluginsProps, "hooks" | "deps" | "kit">) {

  const { t, agentPlugins, error, toggleError } = controller;

  return (
    <section className="jini-settings-section" aria-label={sectionLabel}>
      <p className="agent-plugins-lede">{lede}</p>
      <AgentPluginsStatus
        agentPlugins={agentPlugins}
        visiblePlugins={visiblePlugins ?? []}
        error={error}
        toggleError={toggleError}
        emptyMessage={emptyMessage}
        t={t}
      />
      {visiblePlugins && visiblePlugins.length > 0 ? (
        <AgentPluginList
          {...{ hooks, deps, kit }}
          agentPlugins={visiblePlugins}
          controller={controller}
          uninstallNoteId={uninstallNoteId}
          stateControlFor={stateControlFor}
          updatePort={updatePort}
        />
      ) : null}
      {AgentPluginFootnotes({ uninstallNoteId, t, deps })}
    </section>
  );
}

type AgentPluginListPanelProps = Pick<
  Parameters<typeof AgentPluginListPanel>[0],
  "controller" | "uninstallNoteId" | "stateControlFor" | "updatePort" | "hooks" | "deps" | "kit"
>;

/**
 * Downloaded tab: every package on disk for this workspace, unfiltered — the pre-split
 * `InstalledPanel`'s exact content, retitled. There is no cross-site "downloaded" registry (see
 * `agent-plugins/ws/<workspace>/packages/`), so this list is scoped to the current workspace, not
 * global — the copy below says so rather than implying otherwise.
 *
 * Reuses the pre-split lede and empty-state copy VERBATIM rather than rewording them for
 * "downloaded": a downloaded package that is not yet enabled is exactly the "sits inert until you
 * enable it" case those strings already describe. (Correction: an earlier revision of this comment
 * claimed both were already translated into every `translatePlugins` locale — checked and false,
 * neither has ever had a dictionary entry, pre-dating this split. Reusing them verbatim doesn't
 * regress anything either way, but the claim itself was wrong and is not repeated here.)
 */
export function DownloadedPanel(props: AgentPluginListPanelProps) {
  return (
    <AgentPluginListPanel
      {...props}
      sectionLabel={props.controller.t("Downloaded Agent Plugins")}
      lede={props.controller.t(
        "An installed plugin sits inert until you enable it. Enabling one puts its skills in the assistant's prompt for every run.",
      )}
      emptyMessage={props.controller.t("No Agent Plugins are installed in this workspace.")}
      visiblePlugins={props.controller.agentPlugins}
    />
  );
}

/**
 * Installed tab: every installed plugin, each with its real Enabled switch — off where it's off.
 *
 * Owner decision 2026-09-13: "all agent plugins should be shown even if switched off". Until then
 * this tab listed only `enabled: true` rows, and since every bundled plugin seeds switched off
 * (`seed-bundled.ts`), a newly bundled one like `supabase` was absent from the default tab with no
 * visible way to turn it on. Showing it here changes only the listing: a switched-off plugin's
 * skills, tools, and MCP servers stay out of every assistant run.
 */
export function InstalledOnlyPanel(props: AgentPluginListPanelProps) {
  return (
    <AgentPluginListPanel
      {...props}
      sectionLabel={props.controller.t("Installed Agent Plugins")}
      lede={props.controller.t("Every plugin installed in this workspace. Only switched-on plugins reach the assistant's prompt.")}
      emptyMessage={props.controller.t("No Agent Plugins are installed in this workspace.")}
      visiblePlugins={props.controller.agentPlugins}
    />
  );
}

/**
 * The Marketplace tab: a designed empty state, not a mocked store.
 *
 * There are no listings to show because nothing in the host can fetch, list, or install a remote
 * package — `installAgentPluginFromUrl` exists as a function with zero production callers, and no
 * route or tool reaches it. So this panel shows the one real thing it can honestly offer: where the
 * package format is specified. Anything resembling a browsable catalog here would be a lie the
 * operator would try to click.
 */
export function MarketplacePanel({ t, deps }: { t: Translate; deps: AgentPluginsProps["deps"] }) {
  return (
    <section className="jini-settings-section" aria-label={t("Agent Plugin Marketplace")}>
      <div className="agent-plugins-marketplace-empty" role="note">
        <span className="agent-plugins-marketplace-glyph">
          <MarketplaceIcon size={28} />
        </span>
        <h3>{t("Nothing to browse yet")}</h3>
        <p>{t(deps.marketplaceNote)}</p>
        <p className="jini-field-hint">{t(deps.downloadedNote)}</p>
        {/* On its own line rather than trailing a centered sentence — a link that wraps mid-
            paragraph in a centered block reads as part of the prose instead of as the next step. */}
        <a
          className="agent-plugins-marketplace-link"
          href={AGENT_PLUGINS_SPEC_URL}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: "agent-plugins-marketplace-spec-link" }, {
            role: "link",
            label: "Open the Agent Plugins open standard specification",
          })}
        >
          {t("Read the package format")}
        </a>
      </div>
    </section>
  );
}

function AgentPluginFootnotes({ uninstallNoteId, t, deps }: { uninstallNoteId: string; t: Translate; deps: AgentPluginsProps["deps"] }, _optional = {}) {
  return <>
      {/* `.agent-plugins-footnotes` (styles.css): section-wide facts, not per-plugin details, so
          they stay siblings of the list — but with their own separation, so they read as a footer
          rather than a stray line butted against the last row. Both list tabs share this exact
          footnote (and its handle) rather than each carrying their own — only one tab's panel is
          ever mounted at a time (`TabbedDialog` renders `activeTab.panel` alone), so there is no id
          collision in the live DOM. */}
      <div className="agent-plugins-footnotes">
        <p id={uninstallNoteId} className="jini-field-hint">
          {t(deps.uninstallNote)}
        </p>
        <p className="jini-field-hint">
          {t("Package format:")}{" "}
          <a
            href={AGENT_PLUGINS_SPEC_URL}
            target="_blank"
            rel="noreferrer"
            {...agentHandle({ handle: "agent-plugins-spec-link" }, { role: "link", label: "Open the Agent Plugins open standard specification" })}
          >
            {t("Agent Plugins open standard")}
          </a>
        </p>
      </div>
  </>;
}

function AgentPluginListRowView({ hooks, deps, kit, plugin, controller, uninstallNoteId, stateControlFor, updatePort, agentHandleBase }: Omit<Parameters<typeof AgentPluginList>[0], "agentPlugins"> & { plugin: AgentPluginListRow; agentHandleBase: string }, _optional = {}) {
  const { agentPluginDisplayName, defaultAgentPluginSurfacesPort } = deps;
  const { AgentPluginRow, AgentPluginManageButton } = kit;
  return (
        <AgentPluginRow
          key={plugin.pluginId}
          plugin={plugin}
          t={controller.t}
          locale={controller.locale}
          expanded={controller.expandedIds.has(plugin.pluginId)}
          busy={controller.togglingIds.has(plugin.pluginId)}
          onToggleExpanded={() => controller.onToggleExpanded({ pluginId: plugin.pluginId })}
          stateControl={stateControlFor(plugin)}
          onInspect={() =>
            controller.inspectPlugin({ id: plugin.pluginId, displayName: agentPluginDisplayName(plugin), maturity: plugin.maturity })
          }
          manage={plugin.enabled ? (
            <AgentPluginManageButton
              port={defaultAgentPluginSurfacesPort}
              pluginId={plugin.pluginId}
              displayName={agentPluginDisplayName(plugin)}
              t={controller.t}
              agentHandleBase={agentHandleBase}
              onManage={(surfaces) => controller.inspectPlugin({ id: plugin.pluginId, displayName: agentPluginDisplayName(plugin), maturity: plugin.maturity, surfaces })}
            />
          ) : undefined}
          uninstallNoteId={uninstallNoteId}
          agentHandleBase={agentHandleBase}
          update={updateSlotFor({ plugin, controller, agentHandleBase: agentHandleBase, port: updatePort, hooks, deps, kit })}
        />
  );
}

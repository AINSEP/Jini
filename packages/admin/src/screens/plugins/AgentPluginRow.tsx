import { agentHandle } from "@jini-ai/core/agent-handles";
import { InfoTip } from "../../react/kit.js";
import { useId, type ReactNode } from "react";
import { AgentPluginLinkedLock } from "./AgentPluginLinkedLock.js";
import { AgentPluginMaturity, SOON_PLUGIN_TIP } from "./AgentPluginMaturity.js";

import { PlainTextBlocks } from "../../shell/components/PlainTextBlocks.js";
import { AGENT_PLUGIN_GLYPHS, ChevronIcon, EyeIcon, LockIcon, TrashIcon } from "./agent-plugins-visuals.js";
import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import { usePluginRules } from "./rules-context.js";
import type { PluginRules } from "./rules.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file One installed Agent Plugin, as a ROW rather than a card (redesign, 2026-09-09).
 *
 * ---------------------------------------------------------------------------
 * What this replaced, and why
 * ---------------------------------------------------------------------------
 * Each plugin used to be a bordered `.jini-settings-section-card` holding a `<dl>` of stacked
 * VERSION / STATUS / KEYWORDS label-over-value pairs plus two labelled chip lists. Three installed
 * plugins came to 1275px of inner scroll — every field of every package shouted at once, at the
 * same weight, so nothing could be found by scanning. Owner's verdict on the result was blunt and
 * correct.
 *
 * The fix is hierarchy, not deletion: NOTHING that card showed is gone. The row carries only what
 * an operator scans a list for — is it on, what is it, which version — and the rest (keywords,
 * skills, MCP server ids) moves into a per-row detail panel that opens on demand.
 * Collapsed, a row is two lines.
 *
 * ---------------------------------------------------------------------------
 * Accessibility decisions worth not re-litigating
 * ---------------------------------------------------------------------------
 *  - The switch is a real `role="switch"` with `aria-checked`, and it is NEVER the only signal of
 *    applied state. The state word beside it and the row's left rail say the same thing, because
 *    colour alone must not carry meaning.
 *  - The expander is the row's own summary button (`aria-expanded`/`aria-controls`), not a separate
 *    chevron hit target competing with the three real controls to its right. Its label is its
 *    visible text, so it gets no `aria-label` — one would override the text a sighted user reads.
 *  - The detail panel is ALWAYS rendered and hidden with the `hidden` attribute, so `aria-controls`
 *    always resolves. `styles.css` carries the matching `[hidden] { display: none; }` guard for it,
 *    for the reason `.cms-section-items[hidden]` already documents in that file: a `display` rule
 *    on the element itself outranks the UA stylesheet's own `[hidden]`.
 *  - The icon-only eye and uninstall buttons carry `aria-label`s naming the plugin. "Inspect
 *    package files — {name}" is preserved verbatim from the text button this eye replaced, so the
 *    accessible name (and the translated `Inspect package files` key behind it) survives the
 *    redesign.
 *
 * ---------------------------------------------------------------------------
 * Two state-area shapes, one row (2026-09-09, Downloaded/Installed row-action split)
 * ---------------------------------------------------------------------------
 * Once Downloaded and Installed existed side by side, the same switch on BOTH tabs was genuinely
 * redundant — Installed already tells the operator "this is on" by which rows it lists at all, so
 * repeating the on/off state a second time on Downloaded's identical row added nothing. Owner's
 * call: Installed keeps the real switch (that tab IS the "what's active" view); Downloaded trades it
 * for a single Remove/Enable action naming what clicking it DOES rather than mirroring state that
 * tab doesn't own. `stateControl` (a discriminated union, not a boolean) carries that difference so
 * `AgentPluginList`/`AgentPlugins.tsx` decide the variant once per tab rather than this row
 * re-deriving it — a row has no way to know which tab it is rendering inside otherwise.
 */

/** The row's state-area control. `"toggle"` is Installed's real Enable/Disable switch, unchanged
 *  from before this split. `"remove-or-enable"` is Downloaded's single action: `onRemove` fires for
 *  a currently-enabled row (opens the same confirm dialog the switch does, reworded to "Remove" —
 *  see `AgentPluginDisableConfirmDialog`), `onEnable` for a currently-disabled one (a direct,
 *  unconfirmed call, same as flipping the switch on has always been). Both are supplied always,
 *  regardless of `plugin.enabled` — the row itself, not its caller, decides which one a click
 *  reaches, since only the row already knows the plugin's own current state at render time. */
export type AgentPluginRowStateControl =
  | { readonly kind: "toggle"; readonly onToggleEnabled: () => void }
  | { readonly kind: "remove-or-enable"; readonly onRemove: () => void; readonly onEnable: () => void };

export interface AgentPluginRowProps {
  /** Test seam for the host-bound rule functions (the rows read them from `PluginRulesProvider`). */
  readonly usePluginRulesHook?: typeof usePluginRules;
  readonly plugin: AgentPluginListRow;
  readonly t: Translate;
  readonly locale: string;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onToggleExpanded: () => void;
  readonly stateControl: AgentPluginRowStateControl;
  readonly onInspect: () => void;
  /** The row's Update control (an operator-installed package only; see `updatableAgentPluginDigest`),
   *  shown in the expanded details. The screen builds it, so this row stays props-only. */
  readonly update?: ReactNode;
  /** The plugin's own "Manage" entry (its admin screens), just left of the actions column; absent for most plugins. */
  readonly manage?: ReactNode;
  /** The id of the section-level note explaining why uninstall is unavailable. Referenced by the
   *  disabled uninstall control rather than repeated once per row. */
  readonly uninstallNoteId: string;
  readonly agentHandleBase: string;
}

/** The row's state area — split out of {@link AgentPluginRow} itself so that component's own
 *  branching stays flat; this is the one part of the row whose markup and accessible name genuinely
 *  differ by tab (see this file's own header). */
function AgentPluginRowStateArea({
  plugin,
  t,
  locale,
  busy,
  stateControl,
  agentHandleBase,
  displayName,
  usePluginRulesHook = usePluginRules,
}: {
  plugin: AgentPluginListRow;
  t: Translate;
  locale: string;
  busy: boolean;
  stateControl: AgentPluginRowStateControl;
  agentHandleBase: string;
  displayName: string;
  usePluginRulesHook?: typeof usePluginRules;
}) {
  const { agentPluginToggleAriaLabel } = usePluginRulesHook();
  // "Soon" plugins are locked off (owner 2026-11-10): the server refuses to switch one on, so the
  // switch shows disabled on both tabs, ahead of a linked face's padlock. A disabled control is not
  // focusable, so the padlock tip beside it carries the reason to keyboard and touch. A Soon plugin
  // still on (boot switches those off) keeps its real switch so it can be turned off.
  if (plugin.maturity === "soon" && !plugin.enabled) {
    return (
      <>
        {/* Same shape as the linked row: the state word, then the padlock in the switch's column. The
            disabled switch stays in the DOM (its name and state) but is visually hidden, so the
            divider, word, eye and trash columns line up down the list. */}
        <span className="agent-plugin-state">{t("Disabled")}</span>
        <button type="button" role="switch" aria-checked={false} aria-label={agentPluginToggleAriaLabel({ plugin, locale })} disabled className="agent-plugin-switch agent-plugin-switch--locked">
          <span className="agent-plugin-switch-knob" aria-hidden="true" />
        </button>
        <span className="agent-plugin-linked-lock">
          <InfoTip label={t(SOON_PLUGIN_TIP)} icon={<LockIcon />} agentHandle={`${agentHandleBase}-soon`} />
        </span>
      </>
    );
  }
  // One vendor, one switch (owner 2026-10-25): this plugin follows its provider plugin's switch on
  // the Plugins screen, so on both tabs it shows its state beside a padlock that explains and links
  // there, instead of a switch of its own.
  if (plugin.providerPlugin) {
    return <AgentPluginLinkedLock plugin={plugin} providerPlugin={plugin.providerPlugin} t={t} agentHandleBase={agentHandleBase} />;
  }
  if (stateControl.kind === "toggle") {
    return <AgentPluginToggleState plugin={plugin} t={t} locale={locale} busy={busy} agentHandleBase={agentHandleBase} displayName={displayName} stateControl={stateControl} />;
  }
  return <AgentPluginActionState plugin={plugin} t={t} locale={locale} busy={busy} stateControl={stateControl} agentHandleBase={agentHandleBase} displayName={displayName} />;
}

function AgentPluginToggleState({ plugin, t, locale, busy, agentHandleBase, displayName, stateControl, usePluginRulesHook = usePluginRules }: Omit<Parameters<typeof AgentPluginRowStateArea>[0], "stateControl"> & { stateControl: Extract<AgentPluginRowStateControl, { kind: "toggle" }> }) {
  const { agentPluginToggleAriaLabel } = usePluginRulesHook();
  return (
    <>
      {/* The word, not just the switch's position — see this file's header. */}
      <span className="agent-plugin-state">{plugin.enabled ? t("Enabled") : t("Disabled")}</span>
      <button
        type="button"
        role="switch"
        aria-checked={plugin.enabled}
        aria-label={agentPluginToggleAriaLabel({ plugin, locale })}
        aria-busy={busy}
        disabled={busy}
        className="agent-plugin-switch"
        onClick={stateControl.onToggleEnabled}
        // `checkbox`, not `switch`: `AgentElementRole` (`@jini-ai/agentic`) has no `switch`
        // member, and `checkbox` is the two-state control a page driver already knows how to
        // read and flip. That vocabulary is the DRIVER's, independent of the ARIA `role`
        // above, which stays `switch` because that is what assistive tech should hear.
        {...agentHandle({ handle: `${agentHandleBase}-enabled` }, {
          role: "checkbox",
          label: `${plugin.enabled ? "Disable" : "Enable"} the "${displayName}" Agent Plugin`,
        })}
      >
        <span className="agent-plugin-switch-knob" aria-hidden="true" />
      </button>
    </>
  );
}

function AgentPluginActionState({ plugin, t, locale, busy, stateControl, agentHandleBase, displayName, usePluginRulesHook = usePluginRules }: Omit<Parameters<typeof AgentPluginRowStateArea>[0], "stateControl"> & { stateControl: Extract<AgentPluginRowStateControl, { kind: "remove-or-enable" }> }) {
  const { agentPluginRemoveOrEnableAriaLabel } = usePluginRulesHook();
  // Downloaded: a single action, not a toggle — its own label already names the state (a row
  // reading "Turn off" is implicitly on; one reading "Enable" is implicitly off), so this does not
  // need a second, separate state word the way the switch does.
  const enabled = plugin.enabled;
  const actionWord = enabled ? "Turn off" : "Enable";
  return (
    <button
      type="button"
      aria-busy={busy}
      disabled={busy}
      onClick={enabled ? stateControl.onRemove : stateControl.onEnable}
      aria-label={agentPluginRemoveOrEnableAriaLabel({ plugin, locale })}
      {...agentHandle({ handle: `${agentHandleBase}-${enabled ? "remove" : "enable"}` }, {
        role: "button",
        label: `${actionWord} the "${displayName}" Agent Plugin`,
      })}
    >
      {t(actionWord)}
    </button>
  );
}

/** One labelled chip list inside the detail panel. Rendered only when the package actually declares
 *  the thing — an empty "MCP servers" heading would assert that the question was asked and answered
 *  "none", which is not the same as a package that declares none. Also skipped when its one chip is
 *  just the plugin's own id: 20 of 21 bundled plugins ship exactly one skill named after themselves,
 *  so that chip only repeated the row's name (owner, 2026-10-17). */
function DetailChips({ label, values, ownId }: { label: string; values: readonly string[]; ownId: string }) {
  if (values.length === 0 || (values.length === 1 && values[0] === ownId)) return null;
  return (
    <div className="agent-plugin-detail-group">
      <span className="agent-plugin-detail-label">{label}</span>
      <ul className="agent-plugin-chips">
        {values.map((value) => (
          <li key={value}>
            <code>{value}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Prefer the package's owner-facing summary while preserving its descriptor fallback. */
function agentPluginBlurb(plugin: AgentPluginRowProps["plugin"]): string | null {
  return plugin.summary?.trim() || plugin.description;
}

export function AgentPluginRow(props: AgentPluginRowProps) {
  const { plugin, t, locale, expanded, busy, onToggleExpanded, stateControl, onInspect, manage, uninstallNoteId, agentHandleBase, usePluginRulesHook = usePluginRules } = props;
  const rules = usePluginRulesHook();
  const { agentPluginDisplayName, agentPluginGlyphKind } = rules;
  const displayName = agentPluginDisplayName(plugin);
  // The owner-facing explainer (`extensions.jini.summary`) when the package wrote one; else the
  // spec `description`, which is written for the assistant and can be dense with tool ids.
  const blurb = agentPluginBlurb(plugin);
  const Glyph = AGENT_PLUGIN_GLYPHS[agentPluginGlyphKind(plugin)];
  const detailId = useId();
  const headingId = useId();

  return (
    // `data-linked`: a linked plugin's row reads as disabled here; it is switched on the Plugins page.
    <li className="agent-plugin-row" data-enabled={plugin.enabled} data-linked={plugin.providerPlugin ? true : undefined} aria-label={displayName}>
      <div className="agent-plugin-row-main">
        {renderAgentPluginSummary({ expanded, detailId, headingId, onToggleExpanded, agentHandleBase, displayName, Glyph, plugin, t, blurb, rules })}

        {/* Outside the actions column, against its divider: the switch stays at the same x on every row. */}
        {manage ? <div className="agent-plugin-row-manage">{manage}</div> : null}
        {renderAgentPluginActions({ plugin, t, locale, busy, stateControl, agentHandleBase, displayName, onInspect, uninstallNoteId })}
      </div>

      <div className="agent-plugin-row-detail" id={detailId} hidden={!expanded}>
        {/* The summary line above clips this same string to one line (`.agent-plugin-row-desc`,
            `-webkit-line-clamp: 1`) — a hover tooltip covers a sighted mouse user, but expanding
            the row is the only path assistive tech and touch have, so the full text repeats here,
            unclamped, first — before every other per-plugin fact this panel already held. */}
        <PlainTextBlocks text={blurb} className="agent-plugin-detail-description" />
        {/* The agent-facing `description` and the search `keywords` are NOT rendered here (owner,
            2026-10-17: a "Technical details" wall of tool ids and a 40-chip keyword cloud read as
            noise). Both still reach the assistant unchanged through `search_agent_plugin_local`,
            and the eye button's package viewer shows the raw manifest for anyone who wants it. */}
        <DetailChips label={t("Skills")} values={plugin.skills.map((skill) => skill.name)} ownId={plugin.pluginId} />
        <DetailChips label={t("MCP servers")} values={plugin.mcpServerIds} ownId={plugin.pluginId} />
        {props.update ?? null}
      </div>
    </li>
  );
}

function renderAgentPluginActions(
  { plugin, t, locale, busy, stateControl, agentHandleBase, displayName, onInspect, uninstallNoteId }:
    Pick<AgentPluginRowProps, "plugin" | "t" | "locale" | "busy" | "stateControl" | "agentHandleBase" | "onInspect" | "uninstallNoteId"> &
    { displayName: string }
) {
  return (
    <div className="agent-plugin-row-actions">
      <AgentPluginRowStateArea
        plugin={plugin}
        t={t}
        locale={locale}
        busy={busy}
        stateControl={stateControl}
        agentHandleBase={agentHandleBase}
        displayName={displayName}
      />
      {renderAgentPluginInspect({ onInspect, t, displayName, agentHandleBase })}
      {/* HONEST-DISABLED, not decorative, and the domain agrees.
          `features/agent-plugins/uninstall.ts`'s `uninstallAgentPlugin()` (landed 2026-09-09,
          concurrently with this redesign) REFUSES any package whose activation record says
          `origin: "bundled"`, with `AgentPluginNotUninstallableError` — precisely because
          `recordBundledAgentPluginIfAbsent` re-seeds it on the next boot, so a delete would
          appear to succeed and then silently reappear. That function's own header names this
          screen's enable/disable control (the switch on Installed, Remove/Enable on Downloaded
          — see this file's own header) as the lever an operator actually has for a bundled
          package.

          Every installed package today is bundled — `installAgentPluginFromUrl` exists but has
          zero production callers, so nothing can arrive as `operator-installed` — and there is
          no HTTP uninstall route either (the only wrapper is an assistant tool). So a live
          button here would refuse on every row that exists. It becomes real when an
          install-from-url path ships; until then the affordance holds its place and says why.

          The reason is stated once at section level and referenced by every row via
          `aria-describedby`: a disabled control is not focusable, so a per-row tooltip would
          never be read. */}
      <button
        type="button"
        className="agent-plugin-icon-btn"
        disabled
        aria-label={`${t("Uninstall")} ${displayName} — ${t("unavailable")}`}
        aria-describedby={uninstallNoteId}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function renderAgentPluginInspect(
  { onInspect, t, displayName, agentHandleBase }:
    Pick<Parameters<typeof renderAgentPluginActions>[0], "onInspect" | "t" | "displayName" | "agentHandleBase">
) {
  return (
    <button
      type="button"
      className="agent-plugin-icon-btn"
      onClick={onInspect}
      // Preserved verbatim from the text button this replaced: "Inspect package files" reads
      // identically on every row, so the plugin's own name must stay in the accessible name.
      aria-label={`${t("Inspect package files")} — ${displayName}`}
      {...agentHandle({ handle: `${agentHandleBase}-inspect` }, { role: "button", label: `Inspect the "${displayName}" package files` })}
    >
      <EyeIcon />
    </button>
  );
}

function renderAgentPluginSummary(
  { expanded, detailId, headingId, onToggleExpanded, agentHandleBase, displayName, Glyph, plugin, t, blurb, rules }:
    Pick<AgentPluginRowProps, "expanded" | "onToggleExpanded" | "agentHandleBase" | "plugin" | "t"> &
    { detailId: ReturnType<typeof useId>; headingId: ReturnType<typeof useId>; displayName: string; Glyph: (typeof AGENT_PLUGIN_GLYPHS)[keyof typeof AGENT_PLUGIN_GLYPHS]; rules: PluginRules; blurb: ReturnType<typeof agentPluginBlurb> }
) {
  return (
    <button
      type="button"
      className="agent-plugin-row-summary"
      aria-expanded={expanded}
      aria-controls={detailId}
      // The description lives INSIDE this button so the whole row is one comfortable hit
      // target, but it must not become the button's accessible name — verified rendered, the
      // name was the entire 60-word manifest description read aloud on focus. Pointing at the
      // heading narrows the name to "Site Compliance v1.0.0" while the description stays
      // visible, and stays reachable in browse mode, exactly as before.
      aria-labelledby={headingId}
      onClick={onToggleExpanded}
      {...agentHandle({ handle: `${agentHandleBase}-details` }, { role: "button", label: `Show or hide the "${displayName}" package details` })}
    >
      <span className="agent-plugin-row-glyph">
        <Glyph size={18} />
      </span>
      <span className="agent-plugin-row-text">
        {renderAgentPluginHeading({ headingId, displayName, plugin, t })}
        {plugin.connectionStatus ? <span className="agent-plugin-row-desc">{t({
          connected: "Signed in", disconnected: "Not signed in", pending: "Waiting for sign-in", needs_reauth: "Sign in again",
        }[plugin.connectionStatus])}</span> : null}
        {/* `title` is the ONLY way to read the rest of a clamped line without opening the row —
            a hover tooltip, not a substitute for the unclamped copy below in the expanded
            panel (screen readers and touch have no hover; that copy is the real fix). */}
        {/* Compatibility first: "Not for this product version" explains a switch that refuses to
            turn on, and "Needs …" names capabilities no other enabled plugin provides. */}
        {rules.agentPluginCompatibilityLines({ plugin, translate: t }).map((line) => (
          <span key={line} className="agent-plugin-row-desc">{line}</span>
        ))}
        {blurb ? (
          <span className="agent-plugin-row-desc" title={blurb}>
            {blurb}
          </span>
        ) : null}
      </span>
      <span className="agent-plugin-row-chevron">
        <ChevronIcon />
      </span>
    </button>
  );
}

function renderAgentPluginHeading(
  { headingId, displayName, plugin, t }:
    Pick<Parameters<typeof renderAgentPluginSummary>[0], "headingId" | "displayName" | "plugin" | "t">
) {
  return (
    <span className="agent-plugin-row-heading" id={headingId}>
      <span className="agent-plugin-row-name">{displayName}</span>
      {/* Shown only when the installed package actually carries a version — both are
          genuinely optional in the Agent Plugins spec, and an invented "1.0.0" would be
          worse than an absent chip.

          The explicit `{" "}` is load-bearing, not formatting: this heading IS the summary
          button's accessible name (`aria-labelledby`), and accessible-name computation
          concatenates adjacent inline elements with no separator. The flex `gap` that
          visually separates them is invisible to it, so without a real text node a screen
          reader announced "Site Compliancev1.0.0". */}
      {plugin.version ? (
        <>
          {" "}
          <span className="agent-plugin-row-version">v{plugin.version}</span>
        </>
      ) : null}
      {/* Beside the version (owner, 2026-10-24), so it sits inside the summary button: the
          wrapper keeps a tap on the pill opening its warning (mobile has no hover) instead of
          also toggling the row. Its "Soon"/"Untested" label joins the row's accessible name. */}
      {plugin.maturity ? (
        <>
          {" "}
          <span className="agent-plugin-row-maturity" onClick={(e) => e.stopPropagation()}>
            <AgentPluginMaturity maturity={plugin.maturity} t={t} />
          </span>
        </>
      ) : null}
    </span>
  );
}

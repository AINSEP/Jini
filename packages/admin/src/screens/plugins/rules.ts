import type { AgentPluginListRow } from "../../agent-plugins/models.js";
import type { AdminPluginProviderSettingField } from "./api/plugins-api.types.js";
import type { AdminPluginDto, AdminPluginFilesEnvelope } from "@jini-ai/core/contracts/site/cms-plugins";
import type { PluginConflict } from "@jini-ai/core/contracts/site/plugins-host";
import type { PluginPackageFile } from "@jini-ai/core/contracts/site/host-node";
import type { AgentPluginGlyphKind } from "./agent-plugins-visuals.js";
import { buildPackageFileTree, firstPackageFilePath } from "../../agent-plugins/package-file-tree.js";
import type { PluginInstallPreview } from "./hooks/plugin-install-port.hooks.js";
import { type Translate } from "@jini-ai/core/text";

/** The host's locale-keyed translator: `t({ locale, key })`, the English text being the key. */
export type PluginsLocaleTranslate = (args: { locale: string; key: string }) => string;

/** Everything the rule functions need from the host. One object, so a new seam never becomes a positional argument. */
export interface PluginRulesDeps {
  /** The product's display name, interpolated into every sentence that names it (and into its dictionary key). */
  readonly productName: string;
  /** The host's plugins dictionary lookup, bound to its locales. */
  readonly translate: PluginsLocaleTranslate;
  /** The host's shared fallback chain for an error, used when no plugin-specific message applies. */
  readonly describeApiError: (args: { e: unknown; fallback: string }) => string;
  /** True for the host's own API error class — the only values whose `code` is read. */
  readonly isApiError: (e: unknown) => e is Error & { readonly code?: string };
  /** The plugin host's rule for whether a provider setting is required given the effective values. */
  readonly isProviderSettingRequired: (required: {
    field: Pick<AdminPluginProviderSettingField, "required" | "requiredUnless" | "requiredWhen">;
    values: Readonly<Record<string, unknown>>;
  }) => boolean;
}

export interface PluginRowDetailView {
  readonly quarantine: { readonly headline: string; readonly reason: string } | null;
  readonly conflicts: { readonly heading: string; readonly lines: readonly string[] } | null;
  readonly errors: AdminPluginDto["errors"];
}

export interface PluginRowFact {
  readonly label: string;
  readonly value: string;
}

export interface PluginInstallPreviewDisplay {
  readonly title: string;
  readonly version: string;
  readonly tier: string;
  readonly capabilities: string;
  readonly hooks: string;
  readonly contentTypes: string;
  /** The trust sentence: full access for a package with code, "no code" for a tier-1 one. */
  readonly codeNotice: string;
  readonly conflicts: { readonly heading: string; readonly lines: readonly string[] } | null;
}

/** What the "Enabled" cell should show for one row — `visible: false` for AC-21 (enabling this row
 *  is already known to 422, so no enable-capable control is offered at all; `Roles.tsx`'s
 *  built-in-row `—` idiom). The caller renders `visible` as a plain ternary (button vs. the muted
 *  `—` fallback) on this already-computed result.
 *
 * @complexity O(1).
 */
export interface PluginToggleControl {
  visible: boolean;
  disabled: boolean;
  label: string;
}

export interface PluginRemoveConfirmCopy {
  title: string;
  body: string;
}

export interface AgentPluginDisableConfirmCopy {
  title: string;
  body: string;
  /** Present only when other enabled plugins would lose a capability this one provides. */
  dependents?: string;
}

/**
 * One row of the shared package-files viewer (`PackageFilesModal.tsx`), whichever screen fed it:
 * Agent Plugins' catalog entries fit as they are; `PLUGIN_FILES` entries go through
 * {@link toPackageFileView}.
 */
export interface PackageFileView {
  readonly relativePath: string;
  /** `null` when the file is listed but its content is not shown. */
  readonly content: string | null;
  /** Why `content` is `null`, shown in its place. */
  readonly unavailableReason?: string | null;
}

export interface PackageFilesStatus {
  readonly text: string;
  /** `alert` for a load failure; `status` for loading or an empty package. */
  readonly role: "status" | "alert";
}

export type PackageFilesListing = Pick<AdminPluginFilesEnvelope, "files" | "truncated">;

export interface PackageFilesRead {
  readonly listing: PackageFilesListing | null;
  readonly error: string | null;
}

export interface PackageFilesViewState {
  readonly files: readonly PackageFileView[];
  readonly selectedFile: PackageFileView | null;
  readonly status: PackageFilesStatus | null;
  readonly listNotice: string | null;
}

/** The viewer's own locale, so the package-file tree orders siblings the way the rest of the host sorts. */
export const PACKAGE_FILE_TREE_LOCALE = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).resolvedOptions().locale;

/**
 * Builds the plugins screens' rule functions for one host. The host calls it once and exports the
 * returned names, so the screens import them as plain functions.
 */
export function createPluginRules({ productName, translate: t, describeApiError: describeApiErrorDefault, isApiError, isProviderSettingRequired }: PluginRulesDeps) {
  /** Resource names on the existing assistant content-refresh bus. Unknown scope refreshes both. */
  const PLUGINS_RESOURCE = "plugins";
  const AGENT_PLUGINS_RESOURCE = "agent-plugins";

  /**
   * @file Pure logic for the `plugins` feature — everything that computes a value rather than
   * rendering one. Follows the `posts/rules.ts` convention: no React import, no hooks, directly
   * testable.
   *
   * Moved here from `Plugins.tsx`: the screen's own `describeApiError` override, and the toggle
   * cell's visibility/label decision (`pluginToggleControl`) — previously an inline double ternary
   * inside a `DataTable` cell closure, reachable only by rendering the table.
   */

  /** Overrides layered on the shared default (`lib/api.ts`'s `describeApiError`). Covers both this
   *  screen's routes: `PLUGIN_SET_ENABLED`'s three codes (unchanged) plus `PLUGIN_UNINSTALL`'s four
   *  (`PLUGIN_NOT_FOUND` is shared verbatim between both routes' error envelopes, so it needed no
   *  second entry) — see `server/inbound/admin-http/routes/plugins/uninstall.ts`'s own
   *  `sendPluginUninstallError` for the source of truth these four messages translate.
   *
   *  A `Map`, not an object literal: a server code that happens to name an `Object.prototype` member
   *  (`"toString"`) must fall through to the default, not resolve to a function. */
  const PLUGIN_ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
    ["PLUGIN_NOT_FOUND", "No plugin with that id is installed."],
    ["PLUGIN_INVALID", "This plugin failed validation and cannot be enabled."],
    ["PLUGIN_INCOMPATIBLE", "This plugin requires a different SDK version."],
    ["PLUGIN_NOT_UNINSTALLABLE", `This plugin ships with ${productName} and cannot be removed.`],
    ["PLUGIN_ENABLED", "This plugin is enabled and must be disabled everywhere before it can be removed."],
    ["PLUGIN_IN_TRASH", "This plugin is already in the Trash. Restore or delete it there first."],
    ["PLUGIN_ID_INVALID", "This plugin's id is invalid."],
    // 2026-10-04: `PLUGIN_SET_ENABLED`'s 409 when the plugin claims a name core or an earlier-enabled
    // plugin holds. The server's own message names each clash in English; the row's detail panel
    // already lists them translated (`pluginConflictLines`), so this points there instead.
    ["PLUGIN_CONFLICT", "This plugin uses names that core or another plugin already has. Open its details to see which, and turn the other plugin off first."],
  ]);

  /** Maps this screen's two calls' error codes to `errors.spec.md`'s operator-facing guidance text
   * (ui.spec.md §8), falling back to the server's own message. `optional.translate` translates an
   * override (the English text is the dictionary key); the server's own message is never translated.
   *
   * @complexity O(1).
   * @overallScore 100
   */
  function describeApiError({ e, fallback }: { e: unknown; fallback: string }, optional: { translate?: Translate } = {}): string {
    if (isApiError(e) && e.code !== undefined) {
      const override = PLUGIN_ERROR_MESSAGES.get(e.code);
      if (override !== undefined) return optional.translate ? optional.translate(override) : override;
    }
    return describeApiErrorDefault({ e, fallback });
  }

  /** Replaces each `{name}` in `template` with its value, literally — a function replacer, so a `$&`
   *  or `$'` inside a plugin name or key is not read as a replacement pattern. */
  function fillTemplate({ template, values }: { template: string; values: Readonly<Record<string, string>> }, _optional = {}): string {
    return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, () => value), template);
  }

  /** Display label (an i18n key) per conflict `kind` the server sends — `plugin-claims.ts`'s six
   *  `contributes` kinds, `hook`, and `content-type` (AW-7 Tier 1's declared types). A `Map` for the same prototype-key reason as
   *  {@link PLUGIN_ERROR_MESSAGES}; a kind not listed is shown verbatim (the server's `kind` is free
   *  text by design, so a new one must still render). */
  const CONFLICT_KIND_LABELS: ReadonlyMap<string, string> = new Map([
    ["route", "Route"],
    ["tool", "Tool"],
    ["table", "Table"],
    ["setting", "Setting"],
    ["widget", "Widget"],
    ["permission", "Permission"],
    ["hook", "Hook"],
    ["content-type", "Content type"],
  ]);

  /** The owner id `plugin-claims.ts` files core's own claims under (`CORE_OWNER_ID`). */
  const CORE_CONFLICT_HOLDER = "core";

  /**
   * One sentence per name this plugin claims that core or an earlier-enabled plugin already holds
   * (`PLUGINS_LIST`'s `conflicts[]`, 2026-10-04): for a plugin that is off, what turning it on would
   * hit; for a quarantined one, why boot turned it off. A core holder shows its reserved pattern only
   * when it differs from the claimed key (a `/api/*` prefix matched `/api/seo`). Duplicate lines are
   * dropped — a manifest that names the same thing twice reports it twice.
   *
   * @complexity O(c) in the row's conflict count.
   */
  function pluginConflictLines({ plugin, translate }: { plugin: { readonly conflicts?: readonly PluginConflict[] }; translate: Translate }, _optional: Record<string, never> = {}): string[] {
    const lines = (plugin.conflicts ?? []).map((conflict) => {
      const kindLabel = CONFLICT_KIND_LABELS.get(conflict.kind);
      const values = { kind: kindLabel === undefined ? conflict.kind : translate(kindLabel), key: conflict.key };
      if (conflict.heldBy !== CORE_CONFLICT_HOLDER) {
        return fillTemplate({ template: translate('{kind} "{key}" is already used by {plugin}.'), values: { ...values, plugin: conflict.heldByName } });
      }
      return conflict.heldKey === conflict.key
        ? fillTemplate({ template: translate(`{kind} "{key}" is reserved by ${productName}.`), values })
        : fillTemplate({ template: translate(`{kind} "{key}" is reserved by ${productName} ("{reserved}").`), values: { ...values, reserved: conflict.heldKey } });
    });
    return [...new Set(lines)];
  }

  /**
   * The quarantine headline. Boot's conflict pass quarantines with `consecutiveFailures: 0` (no hook
   * ever failed), where "Quarantined after 0 consecutive failures" would read as a bug; that case says
   * what happened instead, and the reason below it says why.
   *
   * @complexity O(1).
   */
  function pluginQuarantineHeadline({ quarantine, translate }: { quarantine: NonNullable<AdminPluginDto["quarantine"]>; translate: Translate }, _optional: Record<string, never> = {}): string {
    if (quarantine.consecutiveFailures === 0) return translate("Turned off automatically");
    return fillTemplate({ template: translate("Quarantined after {count} consecutive failures"), values: { count: String(quarantine.consecutiveFailures) } });
  }

  /** What the row's detail panel shows — see {@link pluginRowDetailView}. */

  /**
   * The row's detail panel: quarantine, name conflicts, validation errors — each `null`/empty when
   * absent, and the whole view `null` when all three are, so the panel never asserts a question was
   * asked and answered none (`AgentPluginRow`'s `DetailChips` rule).
   *
   * @complexity O(c) in the row's conflict count.
   */
  function pluginRowDetailView({ plugin, translate }: { plugin: AdminPluginDto; translate: Translate }, _optional: Record<string, never> = {}): PluginRowDetailView | null {
    const lines = pluginConflictLines({ plugin, translate });
    if (!plugin.quarantine && lines.length === 0 && plugin.errors.length === 0) return null;
    return {
      quarantine: plugin.quarantine
        ? { headline: pluginQuarantineHeadline({ quarantine: plugin.quarantine, translate }), reason: plugin.quarantine.reason }
        : null,
      conflicts: lines.length > 0 ? { heading: translate("Names already in use — turn the other plugin off first:"), lines } : null,
      errors: plugin.errors,
    };
  }

  /** One labelled fact in the row's detail panel — see {@link pluginRowFacts}. */

  const PLUGIN_SOURCE_COPY: Record<AdminPluginDto["source"], string> = {
    "built-in": `Built in — ships with ${productName}`,
    site: "Installed on this site",
  };

  /** tier-1/tier-3 reuse the install preview's trust sentences; tier-2 (built-ins only — a sideloaded
   *  package cannot claim it) runs in a separate worker over the capability-scoped SDK
   *  (`Jini packages/plugins/src/host/worker/run-call.ts`). */
  const PLUGIN_TIER_COPY: Record<AdminPluginDto["tier"], string> = {
    "tier-1": "This plugin has no code; nothing in it runs on this computer. Turning it on only adds what it declares.",
    "tier-2": "This plugin runs code in a separate worker, limited to the capabilities it declares.",
    "tier-3": "This plugin runs code with full access to this computer and every site on it.",
  };

  const PLUGIN_STATUS_COPY: Record<AdminPluginDto["status"], string> = {
    valid: "No problems found",
    invalid: "Invalid — see the errors below",
    incompatible: `Not compatible with this version of ${productName}`,
  };

  /**
   * The detail panel's always-present facts (mobile catalog PL-2, 2026-10-06). Before this, the
   * panel held only {@link pluginRowDetailView}'s problems, so expanding a HEALTHY plugin — most of
   * them — rotated the chevron over an empty box. `AdminPluginDto` still carries no description (the
   * server envelope has none), so these are the facts the row already has, spelled out: id, where it
   * came from, what it can touch (the same trust sentences the install preview uses), health, and
   * this workspace's on/off state.
   *
   * @complexity O(1).
   */
  function pluginRowFacts({ plugin, translate }: { plugin: AdminPluginDto; translate: Translate }, _optional: Record<string, never> = {}): PluginRowFact[] {
    return [
      { label: translate("ID"), value: plugin.id },
      { label: translate("Source"), value: translate(PLUGIN_SOURCE_COPY[plugin.source]) },
      { label: translate("Access"), value: translate(PLUGIN_TIER_COPY[plugin.tier]) },
      { label: translate("Status"), value: translate(PLUGIN_STATUS_COPY[plugin.status]) },
      { label: translate("State"), value: translate(plugin.enabled ? "On in this workspace" : "Off in this workspace") },
    ];
  }

  /** What the install dialog shows for a reviewed package — see {@link pluginInstallPreviewDisplay}. */

  /**
   * The install dialog's preview. A manifest-only (tier-1) package has nothing to run — the server
   * refuses one that ships a code file — so the full-access warning would be false for it (AW-7
   * Tier 1). Conflicts are the CURRENT workspace's: install is site-wide but turning a plugin on is per
   * workspace, so the heading says so (owner question open: whether to check every workspace).
   *
   * @complexity O(c + n) in the conflict count and the listed names.
   */
  function pluginInstallPreviewDisplay({ preview, translate }: { preview: PluginInstallPreview; translate: Translate }, _optional: Record<string, never> = {}): PluginInstallPreviewDisplay {
    const lines = pluginConflictLines({ plugin: preview, translate });
    return {
      title: `${preview.name} (${preview.id})`,
      version: preview.upgradeFrom ? `${preview.upgradeFrom} → ${preview.version}` : preview.version,
      tier: preview.tier,
      capabilities: preview.capabilities.join(", ") || "—",
      hooks: preview.hooks.join(", ") || "—",
      contentTypes: preview.contentTypes.join(", ") || "—",
      codeNotice: translate(preview.hasCode
        ? "This plugin runs code with full access to this computer and every site on it."
        : "This plugin has no code; nothing in it runs on this computer. Turning it on only adds what it declares."),
      conflicts: lines.length > 0 ? { heading: translate("Already in use in this workspace (other workspaces are checked when you turn it on there):"), lines } : null,
    };
  }


  function pluginToggleControl({ plugin, rowSavingId, locale }: { plugin: AdminPluginDto; rowSavingId: string | null; locale: string }, _optional = {}): PluginToggleControl {
    if (!(plugin.enabled || plugin.status === "valid")) {
      return { visible: false, disabled: false, label: "" };
    }
    const savingThisRow = rowSavingId === plugin.id;
    return {
      visible: true,
      disabled: savingThisRow,
      // The busy-state "…" is locale-neutral (no established translated bare-ellipsis precedent
      // elsewhere in this app — every other busy label pairs it with a word, e.g. posts-i18n.ts's
      // "Creating…") and stays untranslated here on purpose.
      label: savingThisRow ? "…" : t({ locale: locale, key: plugin.enabled ? "Disable" : "Enable" }),
    };
  }

  /**
   * The toggle button's `aria-label` — every row's button reads "Enable"/"Disable"/"…" on its own,
   * identical across every plugin, so a screen reader or a generic browser agent reading the
   * accessibility tree (roles + accessible names — not this repo's own `agentHandle()`, whose
   * `label` option is a private `data-agent-label` attribute neither one can see) has no way to tell
   * one row's control from another's without the plugin's own name in the accessible name.
   *
   * Names the target action (Enable/Disable), not the transient "…" busy word — the visible "…" plus
   * `disabled` already signal in-flight to a sighted operator, and an accessible name that kept
   * switching between "…" and a real verb mid-interaction would be a worse read than one that stays
   * "Enable {name}"/"Disable {name}" throughout.
   *
   * @complexity O(1).
   */
  function pluginToggleAriaLabel({ plugin, locale }: { plugin: AdminPluginDto; locale: string }, _optional = {}): string {
    return `${plugin.enabled ? t({ locale: locale, key: "Disable" }) : t({ locale: locale, key: "Enable" })} ${plugin.name}`;
  }

  /**
   * The row's one-line subline, shown under its name/version heading and repeated inside its
   * expander's own quarantine/errors context: `source · tier · status` (e.g. `"site · tier-3 ·
   * valid"`). `AdminPluginDto` has no free-text description field (unlike `AgentPluginListRow`), so this
   * is built from the trust/health signal the type already carries rather than inventing prose.
   * Values are rendered verbatim, not translated — `plugin.source`/`tier`/`status` are domain
   * enum values, not copy, matching how the pre-split table rendered them (no `t()` wrapping there
   * either).
   *
   * @complexity O(1).
   */
  function pluginSubline(plugin: AdminPluginDto, _optional: Record<string, never> = {}): string {
    return `${plugin.source} · ${plugin.tier} · ${plugin.status}`;
  }

  /**
   * Why the Downloaded tab's Remove cannot succeed for `plugin`, or `null` when it can — the two
   * refusals `PLUGIN_UNINSTALL` itself makes (`Jini packages/plugins/src/host/uninstall.ts`), built-in first:
   * a built-in has nothing on disk to remove whether or not it is on, while an enabled site plugin
   * only needs turning off (`PLUGIN_ENABLED`). The screen shows Remove disabled and pointing at the
   * matching note, instead of offering a click the server always refuses (2026-09-13 fix).
   *
   * `enabled` is this workspace's activation; the server also refuses a plugin still enabled in
   * ANOTHER workspace, which this row cannot see — that rare refusal still reaches `rowError`.
   *
   * @complexity O(1).
   */
  function pluginRemoveBlocker(plugin: AdminPluginDto, _optional: Record<string, never> = {}): "built-in" | "enabled" | null {
    if (plugin.source === "built-in") return "built-in";
    return plugin.enabled ? "enabled" : null;
  }

  /**
   * The Downloaded tab's Remove button `aria-label` — every row's button reads "Remove" identically,
   * so the plugin's own name has to be in the accessible name for anything reading the accessibility
   * tree to tell rows apart (same reasoning {@link pluginToggleAriaLabel} gives for the Installed
   * tab's switch). Reads "unavailable" whenever {@link pluginRemoveBlocker} names a reason instead of
   * naming an action nobody can take — the reason itself lives in the section note the disabled
   * button's `aria-describedby` points at (`AgentPluginRow`'s own honest-disabled idiom).
   *
   * @complexity O(1).
   */
  function pluginRemoveAriaLabel({ plugin, locale }: { plugin: AdminPluginDto; locale: string }, _optional = {}): string {
    return pluginRemoveBlocker(plugin) === null
      ? `${t({ locale: locale, key: "Remove" })} ${plugin.name}`
      : `${t({ locale: locale, key: "Remove" })} ${plugin.name} — ${t({ locale: locale, key: "unavailable" })}`;
  }

  /** {@link buildPluginRemoveConfirmCopy}'s two pieces of copy — same `{ title, body }` shape as
   *  `features/settings/rules.ts`'s `RemoveConfirmCopy`, the precedent this dialog mirrors. */

  /** Names the plugin, the site-wide effect, and the 60-day restore window. @complexity O(1). */
  function buildPluginRemoveConfirmCopy(
    params: { name: string },
    { translate = (key) => key }: { translate?: Translate } = {},
  ): PluginRemoveConfirmCopy {
    return {
      title: `Move "${params.name}" to trash?`,
      body: translate("This removes it for all workspaces on this site. You can restore it from the Trash for 60 days."),
    };
  }

  /**
   * Title-cases a kebab-case Agent Plugin id into a human display name (`"site-compliance"` ->
   * `"Site Compliance"`) — `AGENT_PLUGINS_LIST` (`server/inbound/admin-http/routes/agent-plugins/
   * list.ts`) reports only `pluginId`, never a separate hand-curated `displayName` the way the old,
   * now-deleted `the host-bundled agent-plugin` catalog did, so `AgentPlugins.tsx` needs a pure
   * formatting step rather than a stored field. Mirrors `tool-registrations.ts`'s server-side
   * `humanize()` (same transform, independently kept per that file's own "private formatting helper
   * of a sibling module" precedent — see its header) — that copy has no override map of its own; it
   * feeds an LLM-facing tool description, a different surface this pass did not touch.
   *
   * @complexity O(n) in `pluginId`'s length.
   */
  /**
   * Segments that are acronyms, not words. Title-casing these produced "Ui Ux Design" for the
   * installed `ui-ux-design` package (2026-09-09, seen rendered) — a name an operator has to decode
   * rather than recognize, on the one screen whose whole job is recognizing a package at a glance.
   *
   * A closed list, not a heuristic: no rule distinguishes the acronym "ui" from a hypothetical word
   * segment, and inventing one would eventually shout a real word in capitals.
   */
  const AGENT_PLUGIN_ID_ACRONYMS = new Set([
    "ai", "api", "cli", "css", "html", "http", "id", "io", "json", "mcp", "rss", "sdk", "seo", "sql", "ui", "url", "ux", "yaml",
  ]);

  function humanizeAgentPluginId({ pluginId }: { pluginId: string }, _optional = {}): string {
    return pluginId
      .split("-")
      .filter((part) => part.length > 0)
      .map((part) =>
        AGENT_PLUGIN_ID_ACRONYMS.has(part.toLowerCase())
          ? part.toUpperCase()
          : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(" ");
  }

  /**
   * The name a row shows: the package's own `displayName` (`plugin.json` `extensions.jini.displayName`)
   * when it set one, else {@link humanizeAgentPluginId}. The id stays the stable key; only the title
   * can differ ("deploy" shows as "Server Deploy").
   *
   * @complexity O(n) in `pluginId`'s length.
   */
  function agentPluginDisplayName(plugin: { pluginId: string; displayName?: string | null }): string {
    return plugin.displayName?.trim() || humanizeAgentPluginId({ pluginId: plugin.pluginId });
  }

  /**
   * Vocabulary -> glyph family, in evaluation order. Ordered rather than a flat map because a package
   * can legitimately match two families, and a stable first-match beats whichever key an object
   * happened to iterate first.
   *
   * Matching is on whole words only. A substring match would classify any id containing "ui" —
   * `build-ui`, but also `guide-something` — as a design package.
   */
  const AGENT_PLUGIN_GLYPH_VOCABULARY: ReadonlyArray<readonly [AgentPluginGlyphKind, readonly string[]]> = [
    ["compliance", ["compliance", "privacy", "gdpr", "ccpa", "cpra", "consent", "security", "audit", "wcag", "accessibility"]],
    ["deploy", ["deploy", "deployment", "hosting", "release", "ship", "production", "ci"]],
    ["design", ["design", "ui", "ux", "uiux", "theme", "brand", "visual"]],
    ["integration", ["mcp", "integration", "connector", "webhook", "api"]],
    ["content", ["docs", "documentation", "content", "writing", "copy", "blog"]],
  ];

  /** Lowercase whole-word tokens of one string. */
  function glyphTokens({ value }: { value: string }, _optional = {}): string[] {
    return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  }

  /** First vocabulary family any of `tokens` matches, or `undefined`. */
  function matchGlyphKind(tokens: ReadonlySet<string>): AgentPluginGlyphKind | undefined {
    for (const [kind, vocabulary] of AGENT_PLUGIN_GLYPH_VOCABULARY) {
      if (vocabulary.some((word) => tokens.has(word))) return kind;
    }
    return undefined;
  }

  /**
   * Which glyph identifies one Agent Plugin in the installed list.
   *
   * Derived from the package's OWN vocabulary rather than from an allowlist of known plugin ids. An
   * id allowlist is exactly what `AGENT_PLUGINS_LIST` just replaced (the hardcoded
   * `the host-bundled agent-plugin` catalog), and reintroducing one here would mean a future installed
   * plugin renders with no glyph until someone remembers to add it.
   *
   * The three sources are consulted in TIERS — id, then keywords, then skill names — not merged into
   * one bag. Merging is what the first attempt did, and it put the same shield on `site-compliance`
   * and `ui-ux-design`: the latter's `frontend-accessibility` skill matched the compliance family
   * before anything in its own id was considered, so the two packages this list most needs to tell
   * apart rendered identically. A package's own NAME is the strongest statement of what it is; a
   * skill it happens to bundle is the weakest.
   *
   * Falls back to `"package"` — a deliberately generic glyph — when nothing matches. Guessing a
   * themed icon for an unrecognized package would assert a category the host has no evidence for.
   *
   * @complexity O(k * w) over the package's own token count and the vocabulary size — both small,
   * and computed once per row render.
   */
  function agentPluginGlyphKind(plugin: {
    pluginId: string;
    keywords: readonly string[];
    skills: ReadonlyArray<{ name: string }>;
  }): AgentPluginGlyphKind {
    const tiers: ReadonlyArray<readonly string[]> = [
      glyphTokens({ value: plugin.pluginId }),
      plugin.keywords.flatMap((value) => glyphTokens({ value })),
      plugin.skills.flatMap((skill) => glyphTokens({ value: skill.name })),
    ];

    for (const tier of tiers) {
      const kind = matchGlyphKind(new Set(tier));
      if (kind !== undefined) return kind;
    }
    return "package";
  }

  /**
   * The enable/disable switch's `aria-label`. Same reasoning as {@link pluginToggleAriaLabel} for the
   * sibling screen: every row's switch reads "Enable"/"Disable" identically, so without the plugin's
   * own name in the accessible name, nothing reading the accessibility tree can tell one row's
   * control from another's.
   *
   * Names the target action, not the current state, and never the transient busy state — a `role`
   * of `switch` already publishes the current position through `aria-checked`, and an accessible name
   * that flipped mid-interaction would read worse than one that stays put.
   *
   * @complexity O(1).
   */
  function agentPluginToggleAriaLabel({ plugin, locale }: { plugin: { pluginId: string; enabled: boolean; displayName?: string | null }; locale: string }, _optional = {}): string {
    const verb = plugin.enabled ? t({ locale: locale, key: "Disable" }) : t({ locale: locale, key: "Enable" });
    return `${verb} ${agentPluginDisplayName(plugin)}`;
  }

  /** {@link buildAgentPluginDisableConfirmCopy}'s two pieces of copy — same `{ title, body }` shape as
   *  `features/settings/rules.ts`'s `RemoveConfirmCopy`, the precedent this dialog mirrors. */

  /**
   * Names the exact plugin in the title (an operator with several installed must see WHICH one is
   * about to stop reaching the assistant), and states in the body what disabling actually does and
   * does not do: it is reversible (the package stays on disk and can be re-enabled), unlike
   * `features/settings/rules.ts`'s `buildExternalMcpRemoveConfirmCopy` counterpart, whose "Remove"
   * discards a sealed credential for good.
   *
   * `variant` is the SAME underlying operation (`AGENT_PLUGIN_SET_ENABLED` with `enabled: false`)
   * asked for from two different controls, added when Downloaded's row lost its Enable/Disable switch
   * in favor of a single Turn off/Enable action (2026-09-09 — see `AgentPlugins.tsx`'s own header):
   *   - `"disable"` — Installed tab's switch. Confirm reads "Disable"; the row it guards already says
   *     "Enabled"/"Disabled", so naming the same verb keeps the dialog consistent with the control.
   *   - `"remove"` — Downloaded tab's action button. Confirm reads "Turn off" to match that button, but
   *     the body's bundled-package sentence is reused VERBATIM across both — the fact that this can't
   *     actually delete anything doesn't change based on which control asked.
   *
   * The provenance sentence follows the row's `origin` (2026-10-21: `AGENT_PLUGINS_LIST` now sends
   * it, so the earlier "every row is bundled" assumption tracked here is retired). An
   * `operator-installed` package was added by an operator (an upload or the assistant's install
   * tool): turning it off keeps its files and memory. A bundled one ships with the host and can only be
   * turned off. A row without `origin` comes from a server that predates the field, when every
   * installed package was bundled, so it keeps the bundled sentence.
   *
   * @complexity Time/space: O(1) — one ternary, no iteration.
   */
  function buildAgentPluginDisableConfirmCopy(
    params: { name: string; variant: "disable" | "remove"; origin?: "bundled" | "operator-installed"; requiredBy?: readonly string[] },
    { translate = (key) => key }: { translate?: Translate } = {},
  ): AgentPluginDisableConfirmCopy {
    const copy = disableConfirmCopy(params, translate);
    // Advisory, like the server's own warning: turning it off still goes ahead if confirmed.
    if (!params.requiredBy?.length) return copy;
    return { ...copy, dependents: `${translate("Other enabled plugins rely on it:")} ${params.requiredBy.map((warning) => agentPluginWarningText({ warning, translate })).join("; ")}` };
  }

  /** The title and body of {@link buildAgentPluginDisableConfirmCopy}. @complexity O(1). */
  function disableConfirmCopy(
    params: { name: string; variant: "disable" | "remove"; origin?: "bundled" | "operator-installed" },
    translate: Translate,
  ): AgentPluginDisableConfirmCopy {
    const bundledFact = params.origin === "operator-installed" ? "You added this package. Turning it off keeps its files and memory." : `This package ships with ${productName} — it can't be deleted outright, only turned off.`;
    if (params.variant === "remove") {
      return {
        title: `Turn off ${params.name}?`,
        body:
          translate("This turns it off: its skills stop reaching the assistant on the next run, and it drops off the Installed tab. ") +
          `${translate("It stays right here on Downloaded and can be enabled again any time.")} ${translate(bundledFact)}`,
      };
    }
    return {
      title: `Disable ${params.name} for this site?`,
      body: `${translate("Its skills stop reaching the assistant on the next run. The package stays on disk and can be enabled again.")} ${translate(bundledFact)}`,
    };
  }

  /** Server lifecycle warning texts this screen knows, matched in order; anything else shows as sent. */
  const AGENT_PLUGIN_WARNING_PATTERNS: readonly { readonly pattern: RegExp; readonly render: (required: { match: RegExpMatchArray; translate: Translate }, optional?: Record<string, never>) => string }[] = [
    { pattern: /^Needs (\S+)$/, render: ({ match: m, translate }, _optional = {}) => translate("Needs {capabilities}").replace("{capabilities}", () => m[1] ?? "") },
    { pattern: /^(\S+) needs (\S+)$/, render: ({ match: m, translate }, _optional = {}) => translate("{plugin} needs {capability}").replace("{plugin}", () => m[1] ?? "").replace("{capability}", () => m[2] ?? "") },
    { pattern: /^Unknown release version;/, render: ({ translate }, _optional = {}) => translate("This package has no release version to compare.") },
    { pattern: /^Same version with different bytes;/, render: ({ translate }, _optional = {}) => translate("Same version number as the installed one, with different contents.") },
  ];

  /**
   * One Agent Plugin lifecycle warning in the operator's language. The server (Jini's lifecycle owner)
   * words them in English with plugin and capability ids inside: `Needs x:y` (an unmet requirement),
   * `<plugin> needs <capability>` (a dependent that would lose it) and the two update-plan notes.
   * Ids stay as sent; an unknown warning is shown verbatim rather than dropped.
   * @complexity O(1): four fixed patterns.
   */
  function agentPluginWarningText(required: { warning: string; translate: Translate }, _optional: Record<string, never> = {}): string {
    const { warning, translate } = required;
    for (const { pattern, render } of AGENT_PLUGIN_WARNING_PATTERNS) {
      const match = warning.match(pattern);
      if (match) return render({ match, translate });
    }
    return warning;
  }

  /**
   * The row's compatibility lines, shown under its name: refused by this host version (the switch
   * then answers `PLUGIN_HOST_INCOMPATIBLE`), and capabilities no other enabled plugin provides
   * (advisory: the plugin still turns on). Absent fields, from an older server, show nothing.
   * @complexity O(r) in missing requirements.
   */
  function agentPluginCompatibilityLines(required: { plugin: Pick<AgentPluginListRow, "hostOk" | "missingRequires">; translate: Translate }, _optional: Record<string, never> = {}): string[] {
    const { plugin, translate } = required;
    const lines: string[] = [];
    if (plugin.hostOk === false) lines.push(translate(`Not for this ${productName} version`));
    const missingRequires = plugin.missingRequires;
    if (missingRequires?.length) lines.push(translate("Needs {capabilities}").replace("{capabilities}", () => missingRequires.join(", ")));
    return lines;
  }

  /**
   * Only a package an operator added can be updated from this screen, and only when the server named
   * the installed revision (`archiveDigest`) the update must replace. Bundled packages update with
   * the host itself, so their rows never offer it.
   * @returns The installed revision the update must replace, or `undefined` when the row offers no Update.
   * @complexity O(1).
   */
  function updatableAgentPluginDigest(required: { plugin: Pick<AgentPluginListRow, "origin" | "archiveDigest"> }, _optional: Record<string, never> = {}): string | undefined {
    const { origin, archiveDigest } = required.plugin;
    return origin === "operator-installed" && typeof archiveDigest === "string" && archiveDigest.length > 0 ? archiveDigest : undefined;
  }

  /**
   * Whether the settings card marks a provider field required. Like the chat form, a kept `orPresent`
   * secret (saved, left blank) satisfies the field's `requiredUnless`: the card only knows it is
   * saved, never its value, so it cannot run a `headerNames` check and the server decides on save
   * (2026-10-26 O1: a legacy OTel row authenticated by a saved Authorization header).
   * `values` are the effective values, with the `"saved"` sentinel for kept secrets.
   * @complexity O(f + b) in field count and alternative text.
   */
  function providerSettingRequiredHere(required: { field: AdminPluginProviderSettingField; fields: readonly AdminPluginProviderSettingField[]; entered: Readonly<Record<string, string | undefined>>; values: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): boolean {
    const { field, fields, entered, values } = required;
    const name = field.requiredUnless?.orPresent;
    const alternative = fields.find((other) => other.name === name);
    if (alternative?.secret && alternative.saved && !entered[alternative.name]?.trim()) return false;
    return isProviderSettingRequired({ field, values });
  }

  /**
   * The Downloaded tab's own remove/enable action button `aria-label` — same reasoning as
   * {@link agentPluginToggleAriaLabel} for the Installed tab's switch: every row's button reads
   * "Turn off"/"Enable" identically, so the plugin's own name has to be in the accessible name for
   * anything reading the accessibility tree to tell rows apart.
   *
   * Reads "Turn off" for a currently-enabled row (Downloaded's stand-in for the switch's "on" state —
   * see `AgentPlugins.tsx`'s own header for why Downloaded dropped the switch) and "Enable" for a
   * currently-disabled one, mirroring {@link agentPluginToggleAriaLabel}'s own verb choice exactly so
   * the two tabs describe the same underlying states in the same words.
   *
   * @complexity O(1).
   */
  function agentPluginRemoveOrEnableAriaLabel({ plugin, locale }: { plugin: { pluginId: string; enabled: boolean; displayName?: string | null }; locale: string }, _optional = {}): string {
    const verb = plugin.enabled ? t({ locale: locale, key: "Turn off" }) : t({ locale: locale, key: "Enable" });
    return `${verb} ${agentPluginDisplayName(plugin)}`;
  }


  /** What the viewer's content pane says while no file is selected. */

  /** English source strings (the i18n keys) for each `PLUGIN_FILES` omission reason. */
  const PACKAGE_FILE_OMISSION_NOTICES: Record<NonNullable<PluginPackageFile["omitted"]>, string> = {
    binary: "Binary file — not shown.",
    "too-large": "Too large to show here.",
    symlink: "Symbolic link — not followed.",
    unreadable: "This file could not be read.",
  };

  /**
   * Maps one `PLUGIN_FILES` entry onto a viewer row. An omitted file keeps its place in the list and
   * says why it has no content; a reason this client does not know yet (or a contract-breaking
   * `null` content) reads as unreadable instead of rendering blank.
   * @complexity O(1).
   */
  function toPackageFileView({ file, translate }: { file: PluginPackageFile; translate: Translate }, _optional: Record<string, never> = {}): PackageFileView {
    if (file.omitted === null && file.content !== null) return { relativePath: file.relativePath, content: file.content };
    const notice = (file.omitted && PACKAGE_FILE_OMISSION_NOTICES[file.omitted]) || PACKAGE_FILE_OMISSION_NOTICES.unreadable;
    return { relativePath: file.relativePath, content: null, unavailableReason: translate(notice) };
  }

  /**
   * The content pane's message before a file can be selected: a failure wins, then loading, then an
   * empty package.
   * @complexity O(1).
   */
  function packageFilesStatus(
    { input, translate }: { input: { loading: boolean; error: string | null; fileCount: number }; translate: Translate }, _optional: Record<string, never> = {},
  ): PackageFilesStatus | null {
    if (input.error !== null) return { text: input.error, role: "alert" };
    if (input.loading) return { text: translate("Loading package files…"), role: "status" };
    if (input.fileCount === 0) return { text: translate("No files to show for this plugin."), role: "status" };
    return null;
  }

  /** Set only when `PLUGIN_FILES` reports its caps cut the listing short.
   *  @complexity O(1). */
  function packageFilesListNotice({ listing, translate }: { listing: Pick<AdminPluginFilesEnvelope, "truncated"> | null; translate: Translate }, _optional = {}): string | null {
    return listing?.truncated ? translate("Some files are not listed: this package is larger than the viewer's limits.") : null;
  }

  /** The part of a files listing the viewer reads — shared by `PLUGIN_FILES` and
   *  `AGENT_PLUGIN_FILES`, whose responses differ only outside it. */

  /** One settled package-files read: the listing, or the failure text in its place. */

  /** One query's settled read: its listing, else its error text, else `null` while it loads. */
  function packageFilesRead(query: { data?: PackageFilesListing; error?: Error | null }): PackageFilesRead | null {
    if (query.data) return { listing: query.data, error: null };
    if (query.error) return { listing: null, error: query.error.message };
    return null;
  }

  /** What the package-files viewer renders from one read — see {@link packageFilesViewState}. */

  /**
   * The file whose `relativePath` is `selectedPath`, else the tree's top file row (what the user sees
   * first, not the listing's first entry); `null` only for an empty list. An unknown path falls back
   * the same way rather than clearing the selection.
   * @complexity O(files log files) on the fallback, O(files) otherwise.
   */
  function selectPackageFile({ files, selectedPath }: { files: readonly PackageFileView[]; selectedPath: string }, _optional = {}): PackageFileView | null {
    const selected = files.find((file) => file.relativePath === selectedPath);
    if (selected) return selected;
    const topPath = firstPackageFilePath({ nodes: buildPackageFileTree({ paths: files.map((file) => file.relativePath) }, { locale: PACKAGE_FILE_TREE_LOCALE }) });
    return files.find((file) => file.relativePath === topPath) ?? files[0] ?? null;
  }

  /**
   * Maps one read onto the viewer's rows, selection, status, and caps notice. `read` is `null` while
   * the listing is still loading.
   * @complexity O(files) — capped server-side at 200.
   */
  function packageFilesViewState({ read, selectedPath, translate }: { read: PackageFilesRead | null; selectedPath: string; translate: Translate }, _optional = {}): PackageFilesViewState {
    const listing = read?.listing ?? null;
    const files = (listing?.files ?? []).map((file) => toPackageFileView({ file, translate }));
    return {
      files,
      selectedFile: selectPackageFile({ files, selectedPath }),
      status: packageFilesStatus({ input: { loading: read === null, error: read?.error ?? null, fileCount: files.length }, translate }),
      listNotice: packageFilesListNotice({ listing, translate }),
    };
  }

  return {
    PLUGINS_RESOURCE,
    AGENT_PLUGINS_RESOURCE,
    PACKAGE_FILE_TREE_LOCALE,
    describeApiError,
    pluginConflictLines,
    pluginQuarantineHeadline,
    pluginRowDetailView,
    pluginRowFacts,
    pluginInstallPreviewDisplay,
    pluginToggleControl,
    pluginToggleAriaLabel,
    pluginSubline,
    pluginRemoveBlocker,
    pluginRemoveAriaLabel,
    buildPluginRemoveConfirmCopy,
    humanizeAgentPluginId,
    agentPluginDisplayName,
    agentPluginGlyphKind,
    agentPluginToggleAriaLabel,
    buildAgentPluginDisableConfirmCopy,
    agentPluginWarningText,
    agentPluginCompatibilityLines,
    updatableAgentPluginDigest,
    providerSettingRequiredHere,
    agentPluginRemoveOrEnableAriaLabel,
    toPackageFileView,
    packageFilesStatus,
    packageFilesListNotice,
    packageFilesRead,
    selectPackageFile,
    packageFilesViewState,
  };
}

export type PluginRules = ReturnType<typeof createPluginRules>;

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { PluginHostCopy } from "./plugin-host-copy.js";
/**
 * @file SPEC-005 (ADR-005-ARCH) — the Plugins domain's agent-tool catalog, instantiating SPEC-016
 * REQ-22's naming/callability convention (the same shape `forms/agent-tools.ts`,
 * `Jini packages/user-management/src/server/agent-tools.ts`, `Jini packages/cms/src/content-types/agent-tools.ts`, `features/database/
 * agent-tools.ts`, and `features/recovery/agent-tools.ts` already use).
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each one carries. Every entry maps 1:1 onto a real, already-shipped admin surface:
 * `content_read.plugin` mirrors the host's admin plugins list route (`PLUGINS_LIST`) and `plugins_set_enabled`
 * mirrors the host's admin plugins set-enabled route (`PLUGIN_SET_ENABLED`) exactly — same permissions,
 * same underlying `Jini/packages/plugins/src/host/activation.ts` functions.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is no install/upload tool. `features/plugin-runtime` has no admin ROUTE for either
 *   operation at all — `discoverPlugins()` reads whatever is already present on disk (install dir +
 *   built-ins), and nothing in this codebase's admin HTTP surface adds a plugin's files. A tool
 *   cannot be written against an operation the domain has no route for.
 *   CORRECTED 2026-09-07 (`ADS-memory/reports/2026-09-07-assistant-tool-coverage-audit.md`): this
 *   bullet used to also claim "There is no ... uninstall tool. features/plugin-runtime has no admin
 *   ROUTE for [it] at all" — that was true when originally written, and became false on 2026-08-20
 *   (Milestone 2) when `DELETE /api/admin/v1/workspaces/:workspaceId/plugins/:pluginId`
 *   (`routes/admin/plugins/uninstall.ts`, calling `uninstallPlugin()`) shipped, without this comment
 *   being updated for it — a confidently wrong claim the audit confirmed is exactly what stopped
 *   `plugins_uninstall` from being built. `plugins_uninstall` (below) closes that gap; install/upload
 *   remain genuinely absent at every layer, unlike uninstall.
 *   CORRECTED 2026-10-05: install is no longer absent. The admin folder/ZIP install routes
 *   (`routes/plugins/install.ts`, plugin-install-plan M1a) shipped, and `plugins_install` wraps the
 *   same installer. It lives in its own module and domain (`install-tool.ts`), not this catalog —
 *   see the "install stays separate" reasoning below.
 * - `plugins_uninstall` mirrors the route it wires (`Jini/packages/plugins/src/host/uninstall.ts`) exactly: same
 *   `admin.plugins.enable` permission (no new grant introduced), same two hard preconditions
 *   (`uninstallPlugin()`'s own — the plugin must be a site-installed, non-built-in record, and must
 *   be disabled in every workspace first), same files-first-then-activation-rows ordering. NOT
 *   wrapped in a confirmation dialog the way `content_post_delete`/`deployment_execute_static_publish`
 *   are: this route itself is deliberately NOT wrapped in the change-set/revert gateway either
 *   (`Jini/packages/plugins/src/host/uninstall.ts`'s own header — "there is no meaningful 'restore the prior state' for deleted
 *   bytes"). The description below states the irreversibility in plain language instead.
 *   CORRECTED 2026-09-09: this bullet used to justify that with "there is no existing
 *   human-confirmation transport this tool could reuse without inventing one" — already false when
 *   written (ADR-055 Decision 2's held-open exchange had been serving `content_post_delete` since
 *   2026-08-04), and now visibly so: `plugins_set_enabled` below reuses exactly that transport for
 *   its own enable path (the host's enable-confirmation UI module). Whether `plugins_uninstall` should too is
 *   a live question this file no longer answers with a false premise; it was simply not part of the
 *   pass that gated enabling.
 *   RESOLVED 2026-09-16: `plugins_uninstall` now DOES raise a confirmation dialog and parks on the
 *   human's answer, reusing the exact SAME held-open exchange `plugins_set_enabled`'s enable path
 *   already reuses (`uninstall-confirmation-ui.ts`, ADR-055 Decision 2) — closing the "whether
 *   plugins_uninstall should too" question the paragraph above left open. Two sentences above are now
 *   stale as a result: "NOT wrapped in a confirmation dialog ... are" and "The description below
 *   states the irreversibility in plain language instead" — the description below states BOTH the
 *   irreversibility and the confirmation requirement now. Only the change-set/revert-gateway claim in
 *   that same passage is still accurate: deleting bytes still has no meaningful inverse to capture,
 *   so `executeCommand` is still not used here. Confirmation and revertability are orthogonal
 *   concerns; only the first one changed.
 *   RESOLVED 2026-09-24 (S4): `plugins_uninstall` is now ALSO one tool covering BOTH plugin
 *   families, the same merge `plugins_set_enabled` got below, selected by a REQUIRED `family`
 *   argument — the sentence above ("mirrors the route it wires exactly") described only the
 *   'site-runtime' branch, which is unchanged; the 'agent-plugin' branch runs
 *   `features/agent-plugins/uninstall-tool.ts`'s `runAgentPluginUninstall`, the same logic the
 *   deleted standalone `agent_plugins_uninstall` tool used to run under its own id. Risk is now
 *   `deletes-durable-state` for the whole tool, not `mutates-durable-state` — the worse of the two
 *   families' blast radii (site plugins go to the Trash; Agent Plugins do not), because
 *   `pluginsDerivedRisk` is keyed per tool id, not per family.
 * - `plugins_set_enabled` is ONE tool covering BOTH plugin families (2026-09-09) — the site-plugin package
 *   site/runtime family this module belongs to, AND `features/agent-plugins/`'s separate Agent Plugin
 *   family, selected by a REQUIRED `family` argument. Two tools would have been the smaller diff and
 *   the worse answer: the operator asking "turn on the Higgsfield plugin" does not know which of
 *   the host's two plugin systems that word means, and a model choosing between two near-identically
 *   named enable tools is the exact confusion this catalog exists to prevent. What is deliberately
 *   NOT folded in is install: `DERIVED_RISK_BY_TOOL_ID` is keyed per tool id, so merging a reversible
 *   flag flip with an operation that runs third-party code would force one risk band onto two very
 *   different blast radii. (Uninstall WAS folded in per-family, above — its two families share one
 *   blast radius class, "deletes bytes", even though only one of them has a Trash behind it.)
 * - Enabling, in either family, raises a real human confirmation and PARKS on the answer
 *   (the host's enable-confirmation UI module, ADR-055 Decision 2's held-open exchange). Disabling does not.
 *   See that file's header for why the asymmetry is the point rather than an omission.
 * - `plugins_set_enabled` is included, but is NOT the low-risk "flip a flag" operation its own name
 *   suggests: enabling a plugin whose manifest declares a `dataModule` invokes ADR-023's
 *   core-mediated DDL engine (`@jini-ai/db/data-modules`) against the LIVE database —
 *   snapshot-protected and single-transaction, but genuinely schema-affecting, not a pure metadata
 *   toggle. The tool's own description says so; see this file's header and
 *   `@jini-ai/db/data-modules`'s own header for the full "never-brick" doctrine this rides
 *   on. Still included per this dispatch's brief (comparatively low-risk and REVERSIBLE — disabling
 *   undoes the activation-state flip; a plugin's own DDL is additive/idempotent per ADR-023 §2,
 *   never a drop on disable) — unlike `database_execute_migrate_forward`/`backup_execute_restore`,
 *   which this dispatch's sibling catalogs exclude outright.
 *
 * How it relates to the project:
 * `assistant/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s; the
 * ADR-014 tool filter consumes the catalog to decide which names a session may see. Actual
 * enforcement is the SAME gate the human admin routes use: `content_read.plugin`'s inline `authorize()`
 * call and `plugins_set_enabled`'s `executeCommand`-wrapped permission check (ADR-021 §2) — this
 * module declares shape only and performs no I/O.
 *
 * Architectural role:
 * `features/plugin-runtime` domain declaration. Imports nothing from elsewhere in this package —
 * every entry's input shape is primitive (a string id, a string family, a boolean flag), so there is
 * no shared type to import without inventing a dependency this file does not otherwise need. In
 * particular the `family` enum is restated here rather than imported from
 * `set-enabled-confirmation-ui.ts`'s `PluginFamily`: this module is the CONTRACT the model reads, and
 * a contract that could silently follow a UI module's rename is not a contract. The two are pinned
 * together by test instead (`tool-registrations.plugins-set-enabled-families.test.ts`).
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "deletes-durable-state" | "mints-token";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`assistant/tool-registrations.ts`, which refuses to wire any tool lacking one). Required, not
 * optional — both entries in this catalog are wired, so there is no unwired entry whose input
 * shape is undesigned (mirrors `Jini packages/user-management/src/server/agent-tools.ts`'s reasoning for the same choice).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect; inputSchema: Readonly<Record<string, unknown>> };

/** No arguments — `content_read.plugin` takes none. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

const setEnabledSchema = ({ copy }: { copy: PluginHostCopy }) => ({
  type: "object",
  additionalProperties: false,
  required: ["family", "pluginId", "enabled"],
  properties: {
    family: {
      type: "string",
      enum: ["site-runtime", "agent-plugin"],
      description:
        `Which plugin SYSTEM the id belongs to. Required, and never guessed — ${copy.productName} has two unrelated systems that share the word 'plugin'. ` +
        "Use 'agent-plugin' for an Agent Plugin (an agent-plugins.org package with a plugin.json, skills and an optional mcp.json — " +
        `anything search_agent_plugin_local returned, e.g. an image/video plugin). Use 'site-runtime' for a ${copy.sitePluginFormat} site/runtime plugin — ` +
        `anything ${copy.pluginListToolName} returned. If you did not get the id from one of those two tools, call the matching one first rather ` +
        "than picking a family.",
    },
    pluginId: {
      type: "string",
      minLength: 1,
      description:
        `The plugin id. For family 'site-runtime', as returned by ${copy.pluginListToolName}. For family 'agent-plugin', the plugin.json 'name' as ` +
        "returned by search_agent_plugin_local. An id that is not installed/discovered in THIS workspace is refused, and nothing is written.",
    },
    enabled: {
      type: "boolean",
      description:
        "true to enable, false to disable. ENABLING ALWAYS ASKS THE HUMAN FIRST — this tool opens a confirmation dialog and waits for the " +
        "answer, because turning a plugin on changes what you yourself can do next; do not promise the user it is on until this call returns " +
        "with changed:true. Disabling is not confirmed (it only removes capability). For family 'site-runtime', enabling a plugin whose " +
        "manifest declares a data module runs schema DDL against the live database (ADR-023's snapshot-protected, transactional core-mediated " +
        "engine) and is refused unless the plugin's discovery status is 'valid'; disabling has no such precondition. For family 'agent-plugin', " +
        "enabling reports restartRequired:true for the legacy agent_plugin_<id> registration only. Load its guidance now with " +
        "load_agent_plugin and use agent_plugin_connect if it needs account sign-in. Continue with available tools; do not ask the person " +
        `to restart ${copy.productName} or claim an unavailable tool is ready.`,
    },
  },
} as const);

const uninstallSchema = ({ copy }: { copy: PluginHostCopy }) => ({
  type: "object",
  additionalProperties: false,
  required: ["family", "pluginId"],
  properties: {
    family: {
      type: "string",
      enum: ["site-runtime", "agent-plugin"],
      description:
        "Which plugin SYSTEM the id belongs to. Required, and never guessed — same rule as plugins_set_enabled's 'family' " +
        `argument, and the same reason: ${copy.productName} has two unrelated systems that share the word 'plugin'. Use 'agent-plugin' for an ` +
        "Agent Plugin (an agent-plugins.org package — anything search_agent_plugin_local returned). Use 'site-runtime' for a " +
        `${copy.sitePluginFormat} site/runtime plugin (anything ${copy.pluginListToolName} returned). If you did not get the id from one of those ` +
        "two tools, call the matching one first rather than picking a family.",
    },
    pluginId: {
      type: "string",
      minLength: 1,
      description:
        `The plugin id. For family 'site-runtime', as returned by ${copy.pluginListToolName} — must be a site-installed plugin (a ` +
        "built-in has no on-disk artifact to remove and this is refused). For family 'agent-plugin', the plugin.json 'name' as " +
        `returned by search_agent_plugin_local — must be installed in this workspace and not bundled with ${copy.productName}.`,
    },
  },
} as const);

/**
 * The Plugins domain's fixed agent-tool catalog — the three operations `routes/admin/plugins/`
 * exposes (list, set-enabled, uninstall — see this file's header for install/upload's absence).
 *
 * Ordered read-tool-first, matching the house convention (`Jini packages/user-management/src/server/agent-tools.ts`'s own
 * rationale): a model cannot enable/disable/uninstall a plugin it does not know the id of, and
 * `content_read.plugin` is the only way to learn one.
 */
export function createPluginAgentToolCatalog({ copy }: { copy: PluginHostCopy }, _optional = {}): AgentToolDefinition[] {
  return [
  {
    name: "plugins_list",
    description:
      "Read the plugin inventory: every discovered plugin (built-in and site-installed) with its id, name, version, source, trust tier, validation status, current enabled state, and any validation errors. Read-only. Also returns agentPlugins: every installed Agent Plugin (pluginId, version, archiveDigest, skill names, and exports with component/version/props schema/consent/availability and a ready embed snippet).",
    sideEffects: "none",
    authorization: { permission: "admin.plugins.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "plugins_set_enabled",
    description:
      `Turns a plugin ON or OFF. This is the ONE tool for enabling and disabling plugins, and it covers BOTH of ${copy.productName}'s plugin systems — ` +
      "say which with the required 'family' argument: 'agent-plugin' for an Agent Plugin found by search_agent_plugin_local (e.g. the " +
      `image/video plugin), 'site-runtime' for a ${copy.sitePluginFormat} site plugin listed by ${copy.pluginListToolName}. Use this when the ` +
      "user asks to enable, disable, turn on, turn off, activate or deactivate a plugin, or when a plugin you need is installed but not " +
      "active. Every enable opens the owner's approval card, including site plugins sealed here with plugin_source_seal. " +
      "For Agent Plugins the same card lists the external MCP sources, declared tools and may-write grants to turn on; discovery reloads after approval. " +
      "Disabling is not confirmed. Author site-local behavior with plugin_source_create/open → write/edit → seal → enable (family 'site-runtime'). " +
      "Site plugins support content filters, content types and fields, plus sdk.routes.add (http.route.register + contributes.routes, mounted under /api/p/<plugin-id>), sdk.tools.add (tools.register + contributes.tools, ids p_<normalized-plugin-id>__<name>), and sdk.widgets.add (render.contribute + contributes.widgets, public SSR partials). Refuses to enable a site-runtime plugin whose discovery status is 'invalid' " +
      "or 'incompatible'; enabling one with a data module runs live schema DDL (ADR-023) — reversible in the sense that disabling flips the " +
      "activation flag back, but not a pure no-op toggle. Installing and uninstalling are SEPARATE tools, deliberately: this one only flips " +
      "an already-installed plugin's switch and its listed access; it never installs or removes plugin packages.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "admin.plugins.enable" },
    inputSchema: setEnabledSchema({ copy }),
  },
  {
    name: "plugins_uninstall",
    description:
      `Uninstalls a plugin. This is the ONE tool for uninstalling plugins, and it covers BOTH of ${copy.productName}'s plugin systems — say ` +
      "which with the required 'family' argument, same as plugins_set_enabled. For family 'site-runtime': moves a " +
      "site-installed plugin to the Trash (restorable for 60 days from Admin → Trash; only a human can delete it permanently), " +
      "removing it for all workspaces on this site. Refused if the plugin is a built-in (nothing to remove), or if it is " +
      "currently enabled in ANY workspace (the on-disk artifact is shared across every workspace this instance serves, so " +
      "removing it while another workspace still has it enabled would silently break that workspace) — call " +
      "plugins_set_enabled with enabled:false everywhere it is on first. For family 'agent-plugin': PERMANENTLY removes the " +
      `Agent Plugin from THIS workspace — its package and activation record. This is NOT reversible from inside ${copy.productName}: there ` +
      "is no Trash for this family, and reinstalling means re-running the install with the plugin's archive. Refused if the " +
      `id is not installed in this workspace or is BUNDLED with ${copy.productName} (bundled plugins are re-seeded on every boot) — call ` +
      "plugins_set_enabled with family 'agent-plugin' and enabled false instead. Either way, ALWAYS ASKS THE HUMAN FIRST: " +
      "this tool opens a confirmation dialog and waits for their answer; nothing is removed unless they confirm, and a " +
      "cancel or no answer comes back as a result, not an error.",
    sideEffects: "deletes-durable-state",
    authorization: { permission: "admin.plugins.enable" },
    inputSchema: uninstallSchema({ copy }),
  },
  ];
}

/**
 * @file The dialog `plugins_set_enabled` raises before it turns a plugin ON, for either plugin
 * family.
 *
 * ---------------------------------------------------------------------------
 * Why enabling is confirmed at all, when it is "just a flag"
 * ---------------------------------------------------------------------------
 * Enabling changes what the ASSISTANT can do next, which makes it a privilege escalation the model
 * would otherwise be granting itself:
 *
 * - An Agent Plugin's `SKILL.md` is injected into a run's prompt (`resolve-agent-plugin-refs.ts`),
 *   and its `agent_plugin_<id>` tool is registered for the model to call
 *   (`agent-plugins/tool-registrations.ts`). A disabled plugin gets neither; enabling grants both.
 * - A site-plugin package runtime plugin's enable hook can run ADR-023 schema DDL against the LIVE
 *   database (the host's plugin-runtime composition `onPluginEnabled`), and its
 *   capability tools become registrable (`capability-tool-registrations.ts`).
 *
 * `plugin-runtime/agent-tools.ts`'s own catalog header left this question open in so many words —
 * "whether that is sufficient, or this needs the stronger actor-class/confirmation gating ... is
 * flagged as open in the audit and not decided here". This answers it: enabling, in either family,
 * asks a human first. DISABLING does not, and that asymmetry is deliberate rather than an
 * oversight — disabling only ever REMOVES capability, so there is no escalation to consent to, and
 * a confirmation dialog in front of the off switch is a dialog people learn to click through.
 *
 * ---------------------------------------------------------------------------
 * The mechanism is the held-open exchange, not a token
 * ---------------------------------------------------------------------------
 * Same shape as the host's core human-confirm contract (ADR-055 Decision 2), for the same
 * reasons — see that file's header for the full chain. The model's one call PARKS; the only way to
 * resolve it is a browser POST to `mcp-ui-tool-calls-route.ts`, a channel the model cannot reach.
 * The `exchangeId` interpolated below is a correlation handle, not a secret, and still belongs in
 * this surface and nowhere else: a copy in the tool's `modelText` or an error message would
 * misleadingly suggest a second, independent path back to the parked call, and there is none.
 *
 * `plugins_set_enabled` must therefore also be on `assistant/mcp-ui-tool-calls.ts`'s
 * `MCP_UI_REDEEMABLE_TOOL_IDS` — without it the human's click is refused at the endpoint and the
 * call parks until it expires. That is asserted, not assumed
 * (`tool-registrations.plugins-set-enabled-families.test.ts`).
 */


/** Which plugin system a `plugins_set_enabled` call is about. Explicit, never inferred — the two
 * systems share the word "plugin" and nothing else, and guessing between them has already produced
 * real work in the wrong directory. The catalog owns this contract; approval presentation consumes it. */
export type PluginFamily = 'site-runtime' | 'agent-plugin';
/** The tool id the common access card asks the Host to call back. Single source of truth for both halves. */
export const PLUGINS_SET_ENABLED_TOOL_ID = 'plugins_set_enabled';

import { buildDomainRegistrations, indexCatalogById, isRecord, requireInputRecord, requireString, ToolInputError, requireToolPermission, adaptLegacyAuthorize, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolRegistry, type AgentToolDefinition, type LegacyToolAuthorizeFn, type ToolMetadata, type ToolMetadataById } from "@jini-ai/core";
import { readPluginIdentity } from "@jini-ai/core/plugin-directory";
import type { JsonObject } from "@jini-ai/core/primitives";
import { attachPluginContributionTools, type PluginToolContributionPorts } from "./tool-contributions.js";
import type { PluginContributionRegistry } from "./contributions.js";
import type { PluginActivationRepoPort } from "./activation.js";
import type { PluginDiscoveryRecord } from "./discovery-types.js";
import type { PluginManifest, PluginManifestFieldDecl } from "./manifest-types.js";
import { capabilityToolIdFor } from "./plugin-claims.js";

/**
 * @file Projects each ENABLED plugin-runtime plugin's own declared `fields[]` (manifest.ts,
 * SPEC-005 REQ-06) into one real, `search_tools`-discoverable tool per plugin — the fix for the
 * 2026-08-26 registration-gap audit (`ADS-memory/reports/2026-08-26-plugin-discoverability-audit.md`):
 * a live, valid, tier-3 Word Count plugin was computing and storing a real per-post word count on
 * every save, yet no agent-callable tool anywhere ever exposed it, so `search_tools` correctly
 * returned nothing for "compute word count or reading time statistics for post content" — a
 * registration gap, not a ranking or selection miss.
 *
 * ---------------------------------------------------------------------------
 * Why THIS shape and not the other two the dispatch offered
 * ---------------------------------------------------------------------------
 * Historical field-read decision: the 2026-10-09 owner dispatch now authorizes executable tools
 * through this SAME registrar; these reasons still explain why field-read tools retain their
 * separate contract. The generic executable registration owner is Jini plugins/host.
 *
 * (1) "Plugins declare invocable tools" was rejected as the bigger, contract-changing option: v1's
 * entire capability vocabulary (`Jini/packages/plugins/src/host/manifest.ts`'s `VALID_CAPABILITIES`/`VALID_HOOKS`) has no notion of
 * "expose a callable function" at all, and inventing one — arbitrary handler code a plugin author
 * supplies, executed inside the agent's tool-call path — is a real security/sandboxing question this
 * dispatch's time-box cannot responsibly answer.
 * (3) "Discoverable but not invocable" (a catalog entry that only explains a capability exists) was
 * rejected because the owner's own repro ("is there a way to count words in posts?") needed a real
 * ANSWER, not a pointer — a tool the agent cannot actually call would leave it exactly where it
 * started, manually counting words with Bash.
 * This file is (2): a plugin's already-written, already-durable `ext.{pluginId}.*` output becomes
 * READABLE through one native, read-only tool per plugin — no new execution surface, no new
 * capability vocabulary, just a read path onto data that already exists (`post.ts`'s `ext` field).
 *
 * ---------------------------------------------------------------------------
 * One tool PER PLUGIN, not per field (mirrors `agent-plugins/tool-registrations.ts`'s own
 * one-tool-per-plugin collapse, same rationale: crowding `search_tools`' result slots one field at a
 * time does not scale, and a plugin's fields are typically one cohesive capability anyway).
 * ---------------------------------------------------------------------------
 * Tool id: `plugin_capability_<pluginId>` (hyphens folded to underscores, matching
 * `agent_plugin_<pluginId>`'s own scheme) — deliberately NOT `plugins_*` (already
 * `plugins_list`/`plugins_set_enabled`, the MANAGEMENT tools this is not) and NOT `plugin_*` bare
 * (would read as belonging to the Agent Plugins family). Checked against every existing catalog's
 * ids (`grep -rn 'name: "[a-z_]*"' src/**\/agent-tools.ts src/**\/*tool-registrations.ts`) before
 * choosing it — no collision today. `@jini-ai/core`'s `createToolRegistry().register()` throws on a
 * duplicate id at registration time regardless (verified by reading `tool-registry.ts`), so a future
 * collision fails loudly at boot rather than silently shadowing a native tool — this module does not
 * need to (and does not) reimplement that guard.
 *
 * ---------------------------------------------------------------------------
 * The description text IS the fix — folds each field's own manifest-declared, action-oriented
 * `description` (see `Jini/packages/plugins/src/host/manifest.ts`'s `PluginManifestFieldDecl.description`, added alongside this
 * file) into one tool description. A plugin with no authored field description still gets a tool —
 * degraded to a generic, weaker description ({@link PluginCapabilityToolText.genericFieldDescription}) rather than no tool at
 * all, the same graceful-degradation shape `agent-plugins/tool-registrations.ts`'s
 * `extractFallbackSummary` already uses for a skill with no frontmatter.
 *
 * ---------------------------------------------------------------------------
 * Activation gate — the OPPOSITE default from Agent Plugins, and that is a real, disclosed decision
 * ---------------------------------------------------------------------------
 * `features/agent-plugins/activation.ts` treats an absent activation record as ACTIVE ("presence
 * implies consent"). Plugin-runtime's own projection (`admin-response.ts`: `enabled: activation?.
 * enabled ?? false`) is the opposite: absent means DISABLED. This loader follows plugin-runtime's own
 * convention, not the Agent Plugins one it sits next to — a disabled plugin's `content.entry.
 * beforeSave` hook never fires (`Jini/packages/plugins/src/host/hook-registry.ts`), so its `ext` data (if any survives from when it
 * was last enabled, INV-03) is not being kept fresh. Advertising that as a live capability would be a
 * new bug this file exists to avoid, not fix. Only `status: "valid"` AND `activation.enabled === true`
 * plugins are ever projected into a tool source — verified by both an enabled-plugin test and a
 * disabled-plugin (absent-activation) test in this file's own unit suite.
 *
 * ---------------------------------------------------------------------------
 * Revocation — the activation gate runs AGAIN on every call (t91 F1.2, 2026-09-16)
 * ---------------------------------------------------------------------------
 * The loader above runs once, at daemon boot, and `@jini-ai/core`'s `ToolRegistry` is append-only, so
 * a plugin disabled, quarantined or uninstalled afterwards used to keep a callable tool until restart.
 * Every registration built here therefore carries a `ToolPolicy` that re-reads the activation row
 * before the handler can be reached (`withActivationGate`), mirroring `agent-plugins/
 * tool-registrations.ts`'s REVOCATION note: a refused call ends as `denied` in the daemon audit, and a
 * read that throws also denies (and is logged). Boot filter and per-call gate share one predicate,
 * `isPluginEnabledInWorkspace`, so they cannot drift. The tool stays LISTED until restart; enabling a
 * plugin that was disabled at boot still needs a restart, because there is no registration to re-admit.
 *
 * ---------------------------------------------------------------------------
 * Fresh results for Tier-2 plugins (AW-7 Tier 2, 2026-10-04)
 * ---------------------------------------------------------------------------
 * A stored `ext` value is only as fresh as the post's last save, so "analyze this page" used to answer
 * with whatever the plugin computed then. A tier-2 plugin with a `content.entry.beforeSave` filter
 * ({@link PluginCapabilityToolSource.runsFresh}) now runs again on the post as stored, through the
 * optional `previewPluginBeforeSave` port: the same hook-registry preview the admin editor's
 * "Analyze now" uses, so the code runs in a fresh worker and nothing is saved or counted toward
 * quarantine. Still ONE tool per plugin (no second "analyze" tool competing in `search_tools`).
 * Without the port, or when this process has not attached the plugin, it reads the stored values as
 * before. Tier-3 plugins keep reading stored values: their filter runs in-process, and this change
 * was scoped to the worker-isolated tier. `ExtPatch` is scalar-only, so a plugin stores structured
 * output (content-analyzer's `report`) as a JSON string; {@link decodeFieldValue} hands it back
 * parsed instead of as JSON inside JSON.
 *
 * Architectural role:
 * `features/plugin-runtime` domain declaration, alongside (not replacing) `agent-tools.ts`/
 * `tool-registrations.ts`'s static `plugins_list`/`plugins_set_enabled` pair — this file's tool ids
 * are dynamic (learned only by awaiting `discoverPlugins()` + `pluginActivationRepo`), the same
 * reason `agent-plugins/tool-registrations.ts` is not a synchronous `ToolContributor` either. Called
 * once from `agent-daemon-server.ts`'s `start()`, immediately before `buildToolCatalogQuery` snapshots
 * the registry into a one-shot FTS index — see that call site's own comment for why placement there
 * (not before) makes a registered-late tool invisible to `search_tools`.
 *
 * Seam (2026-11-09): the registrar algorithm lives here; every permission name, entity scope, identity
 * namespace, catalog path, metadata, approval family and model-facing sentence is a required host input
 * of {@link createPluginCapabilityTools}. The host keeps its old module as a thin binder.
 */

/** Model-facing prose for the capability tools. Every sentence is host wording.
 *  @agent-note Second-host rules: the host owns all of this text, including tool names it mentions
 *  and any example values. Members are pure, synchronous and called detached; each must return a
 *  non-empty string. The registrar only concatenates the results in the documented order and never
 *  inspects them, so a host that changes wording changes no behavior. */
export interface PluginCapabilityToolText {
  /** @agent-note Fallback field description when the manifest field has none. Never empty. */
  readonly genericFieldDescription: (required: { pluginName: string; path: string; type: PluginManifestFieldDecl["type"] }, optional?: Record<string, never>) => string;
  /** @agent-note Appended after the space-joined field descriptions; `terms` is the identity id,
   *  keywords and provides joined with single spaces, read through `identityNamespace`. */
  readonly discovery: (required: { terms: string }, optional?: Record<string, never>) => string;
  /** @agent-note Description of a tool that runs the plugin's before-save filter now (tier-2 with
   *  that hook). `fieldText` is the field descriptions plus the discovery suffix. */
  readonly freshDescription: (required: { pluginName: string; fieldText: string }, optional?: Record<string, never>) => string;
  /** @agent-note Description of a tool that reads stored values. Same `fieldText` as above. */
  readonly storedDescription: (required: { pluginName: string; fieldText: string }, optional?: Record<string, never>) => string;
  /** @agent-note The `postId` input property's description in the published input schema. */
  readonly postIdDescription: string;
  /** @agent-note Result `note` when no declared field has a value; added only in that case. */
  readonly noDataNote: (required: { pluginName: string }, optional?: Record<string, never>) => string;
  /** @agent-note Message of the `ToolInputError` thrown when a fresh run fails. The original error
   *  stays on `cause`; the model sees only this text. It must not claim a write happened. */
  readonly previewFailed: (required: { pluginName: string; postId: string }, optional?: Record<string, never>) => string;
  /** @agent-note Warning logged through `console.warn` when the per-call activation read throws and
   *  the call is denied. `detail` is the error message, or `String(value)` for a non-Error. */
  readonly activationReadDenied: (required: { pluginId: string; detail: string }, optional?: Record<string, never>) => string;
}

/** The permission and authorization entity a capability tool call needs.
 *  @agent-note Second-host rules: this ONE object is both published on the catalog entry
 *  (`authorization.permission`) and checked by the handler (`permission` with `entityType` and the
 *  call's post id), so the advertised and enforced permission cannot drift. The host owns the names. */
export interface PluginCapabilityToolAccess {
  /** @agent-note Host permission name; published and enforced. */
  readonly permission: string;
  /** @agent-note Host authorization entity type for the post being read; the entity id is the input `postId`. */
  readonly entityType: string;
}

/** Authority for executable plugin contribution tools attached through the same registrar.
 *  @agent-note Second-host rules: checked on every call with the plugin id as entity id, after the
 *  live activation check; `metadata` is the host's approval metadata for arbitrary plugin code and is
 *  passed unchanged to `attachPluginContributionTools`. A grant resolves to admin access. */
export interface PluginCapabilityExecutableAccess {
  /** @agent-note Host permission required to call an executable plugin tool. */
  readonly permission: string;
  /** @agent-note Host authorization entity type; the entity id is the plugin id. */
  readonly entityType: string;
  /** @agent-note Host tool metadata (approval class/confirmation) for executable plugin tools. */
  readonly metadata: ToolMetadata;
}

/** The minimum a stored post must carry for the capability tools.
 *  @agent-note Read-only view: the registrar reads `id` and `ext[pluginId]` and never writes a post. */
export interface PluginCapabilityPost {
  /** @agent-note Post id echoed into the result payload. */
  readonly id: string;
  /** @agent-note Plugin-namespaced stored values, `{ [pluginId]: { [fieldKey]: value } }`. */
  readonly ext?: JsonObject;
}

/** Host read port for one post.
 *  @agent-note Second-host rules: read-only; must throw the host's own not-found error for an
 *  unknown id (it propagates unchanged). Called once per tool call, after the permission check. */
export interface PluginCapabilityPostReadPort<TPost extends PluginCapabilityPost> {
  /** @agent-note Reads one post in the caller's workspace; never writes. */
  readRequired(input: { workspaceId: string; id: string }, options?: Record<string, never>): Promise<TPost>;
}

/** Runs ONE attached plugin's before-save filter on a draft without saving.
 *  @agent-note Existing positional plugin callback ABI, kept as is. Second-host rules: must write
 *  nothing, count nothing toward quarantine, and resolve `null` when this process has not attached
 *  the plugin (the stored values are then read). A rejection becomes `text.previewFailed`. */
export type PluginCapabilityPreviewPort<TDraft> = (pluginId: string, entry: TDraft) => Promise<Readonly<Record<string, unknown>> | null>;

/** Applies the host's extension approval policy to one built registration.
 *  @agent-note Second-host rules: called once per registration AFTER the activation gate is
 *  wrapped, with the host-supplied `approvalFamily`; must return a registration for the same id. */
export type PluginCapabilityApprovalPort<TFamily extends string> = (required: { registration: ToolRegistration; family: TFamily }, optional?: Record<string, never>) => ToolRegistration;

/** One resolved, already-namespace-parsed `ext.{pluginId}.*` field this tool can read back.
 *  @agent-note Built only from a `status: "valid"` manifest; no host input. */
export interface PluginCapabilityFieldSource {
  /** The full manifest-declared path, e.g. `"ext.word-count.count"`.
   *  @agent-note Manifest data, already validated; no host input. */
  readonly path: string;
  /** The key this field is stored under inside `post.ext[pluginId]` — `path` with the
   *  `ext.{pluginId}.` prefix stripped (e.g. `"count"`). Namespacing is already enforced by
   *  `Jini/packages/plugins/src/host/manifest.ts`'s `validateField` before a record can ever reach `status: "valid"`, so this is a
   *  plain slice, not a re-validation.
   *  @agent-note Key of this field in the result payload's `fields` object. */
  readonly fieldKey: string;
  /** @agent-note Manifest field type, passed to the host's generic description only. */
  readonly type: PluginManifestFieldDecl["type"];
  /** Action-oriented, human-authored text when the manifest supplies one; otherwise
   *  {@link PluginCapabilityToolText.genericFieldDescription}'s weaker fallback. Never empty.
   *  @agent-note Plugin-authored or host-worded text; indexed for tool search. */
  readonly description: string;
}

/** One enabled plugin's tool-ready source — everything {@link PluginCapabilityTools.buildRegistrations}
 *  needs to mint one real `ToolRegistration`, with nothing left for the handler to (re)compute from
 *  raw discovery/activation state at call time.
 *  @agent-note `id` is {@link capabilityToolIdFor}'s saved `plugin_capability_<id>` derivation, the
 *  same id the conflict detector claims; hosts must not re-derive it. */
export interface PluginCapabilityToolSource {
  /** @agent-note Saved tool id; see the interface note. */
  readonly id: string;
  /** @agent-note Activation key re-read on every call. */
  readonly pluginId: string;
  /** @agent-note Manifest display name handed to the host's text members. */
  readonly pluginName: string;
  /** @agent-note Host-worded model-facing description, built once at load. */
  readonly description: string;
  /** @agent-note Declared fields in manifest order; the result payload follows this order. */
  readonly fields: readonly PluginCapabilityFieldSource[];
  /** A tier-2 plugin with a `content.entry.beforeSave` filter: each call runs that filter on the
   *  stored post through `PluginCapabilityToolDeps.previewPluginBeforeSave` — see this file's header,
   *  "Fresh results for Tier-2 plugins".
   *  @agent-note Fresh calls go through the host preview port and write nothing. */
  readonly runsFresh: boolean;
}

/** Per-workspace call dependencies.
 *  @agent-note Second-host rules: pass the SAME object to every member; it is held by reference and
 *  each member is read when used (activation repo on every call, preview port per call), never copied.
 *  Use the same activation repository the enable/disable path writes so revocation is seen at once. */
export interface PluginCapabilityToolDeps<TPost extends PluginCapabilityPost, TDraft> {
  /** @agent-note Optional executable contribution registry; attached only when present. */
  readonly pluginContributions?: PluginContributionRegistry;
  /** @agent-note Separate registry for executable tools; otherwise the given registry when it can list. */
  readonly executablePluginToolRegistry?: ToolRegistry;
  /** @agent-note Host authorization callback (legacy flat shape), adapted per check. */
  readonly authorize: LegacyToolAuthorizeFn;
  /** @agent-note The one workspace every read and check is scoped to. */
  readonly workspaceId: string;
  /** @agent-note Read-only post port. */
  readonly postRead: PluginCapabilityPostReadPort<TPost>;
  /** Re-read on EVERY call by each registration's policy — see this file's header, "Revocation".
   *  @agent-note A read that throws denies the call and is logged. */
  readonly pluginActivationRepo: PluginActivationRepoPort;
  /** Runs ONE attached plugin's beforeSave filter on a draft without saving — the composition
   *  root's `previewPluginBeforeSave` binding (`HookRegistry.previewBeforeSave`). Omitted ⇒ every
   *  tool reads stored values. See this file's header, "Fresh results for Tier-2 plugins".
   *  @agent-note Optional; read per call. */
  readonly previewPluginBeforeSave?: PluginCapabilityPreviewPort<TDraft>;
}

/** Discovery-time dependencies of {@link PluginCapabilityTools.loadSources}.
 *  @agent-note One discovery call; one activation read per field-declaring valid plugin. */
export interface PluginCapabilitySourceDeps {
  /** @agent-note Workspace whose activation rows decide which plugins get a tool. */
  readonly workspaceId: string;
  /** @agent-note Host discovery; called once per load, never per plugin. */
  readonly discoverPlugins: () => Promise<readonly PluginDiscoveryRecord[]>;
  /** @agent-note Same activation repository the per-call gate reads. */
  readonly pluginActivationRepo: PluginActivationRepoPort;
}

/** Host inputs of {@link createPluginCapabilityTools}.
 *  @agent-note Second-host rules: everything a host names lives here; one instance per host
 *  vocabulary (it holds no per-workspace state, so one instance serves every workspace). */
export interface PluginCapabilityToolsRequired<TPost extends PluginCapabilityPost, TDraft, TFamily extends string> {
  /** @agent-note Namespace passed to `readPluginIdentity` for the discovery terms. */
  readonly identityNamespace: string;
  /** @agent-note All model-facing prose; see {@link PluginCapabilityToolText}. */
  readonly text: PluginCapabilityToolText;
  /** @agent-note `buildDomainRegistrations` inputs: `domain` (failure messages), `catalogModule`
   *  (the host file named in drift messages) and `metadata` (host tool metadata by id). */
  readonly catalog: { readonly domain: string; readonly catalogModule: string; readonly metadata: ToolMetadataById };
  /** @agent-note Same object reaches catalog entry and handler. */
  readonly access: PluginCapabilityToolAccess;
  /** @agent-note Authority for executable contribution tools. */
  readonly executableAccess: PluginCapabilityExecutableAccess;
  /** @agent-note Family handed to the approval port with every registration. */
  readonly approvalFamily: TFamily;
  /** @agent-note Builds the host's before-save draft from the stored post, per fresh call; the host
   *  owns the payload fields (the same ones its save path hands the filter on an update). */
  readonly toPreviewDraft: (required: { post: TPost }, optional?: Record<string, never>) => TDraft;
}

/** The registrar bound to one host vocabulary.
 *  @agent-note Second-host rules: call `registerEnabled` (or `loadSources` + `buildRegistrations`)
 *  BEFORE any one-shot tool search index snapshots the registry; a later registration is invisible
 *  to search. Registry id collisions throw from `register` and are not caught here. */
export interface PluginCapabilityTools<TPost extends PluginCapabilityPost, TDraft, TFamily extends string> {
  /** @agent-note Valid, enabled, field-declaring plugins only, in discovery order. */
  loadSources(required: PluginCapabilitySourceDeps, optional?: Record<string, never>): Promise<readonly PluginCapabilityToolSource[]>;
  /** @agent-note Pure and synchronous; each registration is gate-wrapped, then approval-wrapped. */
  buildRegistrations(required: { sources: readonly PluginCapabilityToolSource[]; deps: PluginCapabilityToolDeps<TPost, TDraft>; applyApprovalPolicy: PluginCapabilityApprovalPort<TFamily> }, optional?: Record<string, never>): ToolRegistration[];
  /** @agent-note Loads, registers each field tool, then attaches executable contribution tools when a
   *  contribution registry and a listable registry are present. */
  registerEnabled(required: { registry: PluginCapabilityRegistryPort; deps: PluginCapabilityToolDeps<TPost, TDraft> & PluginCapabilitySourceDeps; applyApprovalPolicy: PluginCapabilityApprovalPort<TFamily> }, optional?: Record<string, never>): Promise<void>;
}

/** The registry surface `registerEnabled` uses.
 *  @agent-note `register` must throw on a duplicate id; `has` and `list` are needed only for
 *  attaching executable tools to this same registry. */
export interface PluginCapabilityRegistryPort {
  /** @agent-note Throws on a duplicate id; not caught by the registrar. */
  register: (registration: ToolRegistration) => void;
  /** @agent-note With `list`, lets executable tools attach to this registry. */
  has?: ToolRegistry["has"];
  /** @agent-note With `has`, lets executable tools attach to this registry. */
  list?: ToolRegistry["list"];
}

/** `plugin_capability_<pluginId>` — see this file's header, "Tool id scheme". The derivation lives in
 *  `Jini/packages/plugins/src/host/plugin-claims.ts` (2026-10-04) so the conflict detector claims exactly the id registered here. */

/** The ONE definition of "this plugin's capability tool may exist / may run": this workspace's activation
 *  row says `enabled: true`. Absent, disabled, quarantined (saved `enabled: false`) and uninstalled (every
 *  row deleted) all answer false. Shared by the boot filter and the per-call gate — see this file's header,
 *  "Revocation". @complexity one activation-row read. */
async function isPluginEnabledInWorkspace(repo: PluginActivationRepoPort, workspaceId: string, pluginId: string): Promise<boolean> {
  const activation = await repo.getActivation({ workspaceId, pluginId });
  return activation?.enabled === true;
}

/** Whether this plugin's tool computes a fresh result instead of reading the stored one — see this
 *  file's header, "Fresh results for Tier-2 plugins". */
function runsFreshFor(manifest: PluginManifest): boolean {
  return manifest.tier === "tier-2" && manifest.hooks.includes("content.entry.beforeSave");
}

/** This module's own risk classification — every capability tool is a pure read of an already-saved
 *  post's already-computed `ext` bag: no domain call, no write path. Mirrors
 *  `agent-plugins/tool-registrations.ts`'s identical `"none"` classification for the same reason.
 *  @agent-note Host-independent: every source is classified `"none"`. */
export function pluginCapabilityToolDerivedRisk(required: { sources: readonly PluginCapabilityToolSource[] }, _optional: Record<string, never> = {}): DerivedRiskByToolId {
  return new Map(required.sources.map((source) => [source.id, "none" as const]));
}

/** Reads one plugin's stored field bag off an already-loaded post, defensively — `post.ext` is
 *  typed as a generic `JsonObject` (see `post.ts`'s own field doc), so this narrows with `isRecord`
 *  at each level rather than casting, and treats any unexpected shape the same as "not yet written"
 *  (`undefined`, then `null` + note) rather than throwing on data this handler does not own the shape of. */
function readStoredFieldBag(source: PluginCapabilityToolSource, post: PluginCapabilityPost): Record<string, unknown> | undefined {
  const extension = { value: post.ext };
  const candidate = { value: isRecord(extension) ? extension.value[source.pluginId] : undefined };
  return isRecord(candidate) ? candidate.value : undefined;
}

/** A string field holding a JSON object or array comes back parsed (see this file's header, "Fresh
 *  results for Tier-2 plugins"); every other value, including a string that only looks like JSON,
 *  is returned exactly as written. @complexity O(value length). */
function decodeFieldValue(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Binds the capability-tool registrar to one host vocabulary.
 * @agent-note Second-host rules: supply every required input; nothing has a default. The returned
 * members hold no state between calls; per-workspace state lives in the `deps` object the caller
 * passes (held by reference). Calls to the host ports happen in this order per tool call: activation
 * read (policy), inner policy, approval policy, permission check, post read, optional preview.
 * @param required Host vocabulary and ports, see {@link PluginCapabilityToolsRequired}.
 * @param _optional Reserved; pass `{}`.
 */
export function createPluginCapabilityTools<TPost extends PluginCapabilityPost, TDraft, TFamily extends string>(
  required: PluginCapabilityToolsRequired<TPost, TDraft, TFamily>,
  _optional: Record<string, never> = {},
): PluginCapabilityTools<TPost, TDraft, TFamily> {
  const { identityNamespace, text, catalog, access, executableAccess, approvalFamily, toPreviewDraft } = required;
  type Deps = PluginCapabilityToolDeps<TPost, TDraft>;

  /** Fallback for a field whose manifest declares no `description` (see this file's header,
   *  "description text IS the fix") — weaker (a noun-phrase, not an action), but still a usable,
   *  non-empty tool description rather than no tool at all. */
  function genericFieldDescription(pluginName: string, field: PluginManifestFieldDecl): string {
    return text.genericFieldDescription({ pluginName, path: field.path, type: field.type });
  }

  /**
   * Resolves one valid manifest's declared fields into tool-ready sources — `expectedPrefix` mirrors
   * `manifest.ts`'s own `validateFields` derivation exactly, so a field this function accepts is
   * guaranteed already-validated namespacing, never a fresh assumption this file invents.
   *
   * @complexity O(fields.length) — one manifest's own declared array.
   */
  function buildFieldSources(manifest: PluginManifest): readonly PluginCapabilityFieldSource[] {
    const expectedPrefix = `ext.${manifest.id}.`;
    return manifest.fields
      .filter((field) => field.path.startsWith(expectedPrefix) && field.path.length > expectedPrefix.length)
      .map((field) => ({
        path: field.path,
        fieldKey: field.path.slice(expectedPrefix.length),
        type: field.type,
        description: field.description ?? genericFieldDescription(manifest.name, field),
      }));
  }

  /**
   * Builds this plugin tool's model-facing description — an operator SEARCH TARGET, not a card blurb
   * (mirrors `agent-plugins/tool-registrations.ts`'s `buildPluginToolDescription` doc on the same
   * point). Leads with an imperative action clause, folds in every field's own description text (the
   * actual indexed vocabulary a real query needs to match), and states the `postId` precondition and
   * the "no data yet" outcome up front so a model reading only this description already knows how to
   * call it and what an empty result means.
   */
  function buildCapabilityToolDescription(manifest: PluginManifest, fields: readonly PluginCapabilityFieldSource[]): string {
    const identity = readPluginIdentity({ manifest: manifest as unknown as Readonly<Record<string, unknown>>, name: manifest.id, namespace: identityNamespace });
    const fieldText = fields.map((field) => field.description).join(" ") + text.discovery({ terms: [identity.id, ...identity.keywords, ...identity.provides].join(" ") });
    if (runsFreshFor(manifest)) {
      return text.freshDescription({ pluginName: manifest.name, fieldText });
    }
    return text.storedDescription({ pluginName: manifest.name, fieldText });
  }

  /**
   * Loads every ENABLED, valid plugin-runtime plugin that declares at least one field, resolved into
   * one tool-ready source per plugin. See this file's header, "Activation gate", for why "enabled"
   * here means `activation.enabled === true` — the opposite default from Agent Plugins.
   *
   * @complexity O(p) plugin-discovery calls times one `pluginActivationRepo.getActivation` each,
   * dominated by `discoverPlugins()`'s own I/O (unchanged, not re-read per plugin).
   */
  async function loadEnabledPluginCapabilityToolSources(deps: PluginCapabilitySourceDeps): Promise<readonly PluginCapabilityToolSource[]> {
    const discovery = await deps.discoverPlugins();
    const sources: PluginCapabilityToolSource[] = [];

    for (const record of discovery) {
      // No fields means nothing this plugin's tool could ever return. Disabled (or never activated)
      // plugins stay out too — see this file's header. Preserve that short-circuit order.
      if (record.status !== "valid" || !record.manifest || record.manifest.fields.length === 0 ||
        !(await isPluginEnabledInWorkspace(deps.pluginActivationRepo, deps.workspaceId, record.id))) continue;

      const fields = buildFieldSources(record.manifest);
      if (fields.length > 0) sources.push({
        id: capabilityToolIdFor({ pluginId: record.id }),
        pluginId: record.id,
        pluginName: record.manifest.name,
        description: buildCapabilityToolDescription(record.manifest, fields),
        fields,
        runsFresh: runsFreshFor(record.manifest),
      });
    }

    return sources;
  }

  function buildCapabilityInputSchema(): Record<string, unknown> {
    return {
      type: "object",
      additionalProperties: false,
      required: ["postId"],
      properties: {
        postId: {
          type: "string",
          minLength: 1,
          description: text.postIdDescription,
        },
      },
    };
  }

  /** Projects one plugin's field bag — stored, or fresh from the preview port (`computedNow`) — onto
   *  its declared fields, adding the "not computed yet" note when none of them has a value. */
  function buildCapabilityToolResult(
    source: PluginCapabilityToolSource,
    post: TPost,
    bag: { values: Record<string, unknown> | undefined; computedNow: boolean },
  ): Record<string, unknown> {
    const pluginBag = bag.values;
    const fields: Record<string, unknown> = {};
    let anyComputed = false;
    for (const field of source.fields) {
      const value = pluginBag ? pluginBag[field.fieldKey] : undefined;
      fields[field.fieldKey] = value === undefined ? null : decodeFieldValue(value);
      if (value !== undefined) anyComputed = true;
    }

    return {
      postId: post.id,
      pluginId: source.pluginId,
      computedNow: bag.computedNow,
      fields,
      ...(anyComputed
        ? {}
        : {
            note: text.noDataNote({ pluginName: source.pluginName }),
          }),
    };
  }

  /** The field bag one call answers with: a fresh preview for a {@link PluginCapabilityToolSource.runsFresh}
   *  source when the port is injected and this process has the plugin attached, otherwise the stored one.
   *  The draft is the post exactly as stored — the same fields `post.ts` hands the filter on an update.
   *  @throws {ToolInputError} the fresh run failed; the cause stays on the error, the model sees fixed text.
   *  @complexity one post-draft preview (a worker round trip for tier-2) or none. */
  async function resolveFieldBag(
    source: PluginCapabilityToolSource,
    post: TPost,
    deps: Deps,
  ): Promise<{ values: Record<string, unknown> | undefined; computedNow: boolean }> {
    const preview = source.runsFresh ? deps.previewPluginBeforeSave : undefined;
    const fresh = preview
      ? await preview(source.pluginId, toPreviewDraft({ post })).catch((error: unknown) => {
          throw new ToolInputError(
            {
              message: text.previewFailed({ pluginName: source.pluginName, postId: post.id }),
            },
            { cause: error },
          );
        })
      : null;
    return fresh ? { values: fresh, computedNow: true } : { values: readStoredFieldBag(source, post), computedNow: false };
  }

  /** One source's catalog entry. The host's `access.permission` — the same object the handler checks. */
  function capabilityCatalogEntry(source: PluginCapabilityToolSource): AgentToolDefinition {
    return {
      name: source.id,
      description: source.description,
      sideEffects: "none",
      authorization: { permission: access.permission },
      inputSchema: buildCapabilityInputSchema(),
    };
  }

  /** One source's handler. @complexity one permission check, one post read, and at most one fresh preview. */
  function capabilityToolHandler(source: PluginCapabilityToolSource, deps: Deps): ToolHandler {
    return async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const postId = requireString({ input: input, key: "postId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: access.permission }, { entityType: access.entityType, entityId: postId });

      const post = await deps.postRead.readRequired({ workspaceId: deps.workspaceId, id: postId });
      return buildCapabilityToolResult(source, post, await resolveFieldBag(source, post, deps));
    };
  }

  /** Whether `pluginId` may run right now. A read that throws DENIES and is logged, rather than surfacing as a
   *  failed execution whose cause the daemon redacts. @complexity one activation-row read. */
  async function isCapabilityCallableNow(deps: Deps, pluginId: string): Promise<boolean> {
    try {
      return await isPluginEnabledInWorkspace(deps.pluginActivationRepo, deps.workspaceId, pluginId);
    } catch (error) {
      console.warn(
        text.activationReadDenied({ pluginId, detail: error instanceof Error ? error.message : String(error) }),
      );
      return false;
    }
  }

  /**
   * Wraps one registration's policy so the plugin's CURRENT activation is re-read before its handler can be
   * reached, then defers to the policy `buildDomainRegistrations` attached — the same shape and reason as
   * `agent-plugins/tool-registrations.ts`'s `withToolGate` (a future kit policy must not be silently dropped).
   * @complexity O(1) plus one activation-row read per call.
   */
  function withActivationGate(registration: ToolRegistration, deps: Deps, pluginId: string): ToolRegistration {
    const inner = registration.policy;
    return {
      ...registration,
      policy: {
        async authorize(authCtx) {
          if (!(await isCapabilityCallableNow(deps, pluginId))) return "deny";
          return inner.authorize(authCtx);
        },
      },
    };
  }

  /**
   * Turns already-resolved plugin capability sources into real `ToolRegistration`s — pure and
   * synchronous, unlike {@link loadEnabledPluginCapabilityToolSources}, so this half is unit-tested
   * without touching activation/discovery I/O. Uses the same `buildDomainRegistrations` gate every
   * other domain's `tool-registrations.ts` uses (catalog/risk cross-check, `inputSchema` presence,
   * drift tripwire) — not a parallel mechanism.
   *
   * Permission: the host's `access.permission`, the same permission its own post read tool requires —
   * this tool reads a post's already-persisted data, nothing a plugin-specific permission would
   * meaningfully narrow further (mirrors that tool's own inline `requireToolPermission` call exactly,
   * including the `entityType`/`entityId` pair so a per-post authorization rule can still apply).
   *
   * Every registration carries the per-call activation gate (`withActivationGate`) — see this file's
   * header, "Revocation". Built one source at a time so the owning plugin id is in scope for every
   * registration the kit returns: there is no id-to-plugin lookup that could miss and leave a tool
   * ungated. The build stays synchronous and touches no I/O; the gate reads only when a call is
   * authorized.
   */
  function buildPluginCapabilityToolRegistrations(
    { sources, deps, applyApprovalPolicy }: { sources: readonly PluginCapabilityToolSource[]; deps: Deps; applyApprovalPolicy: PluginCapabilityApprovalPort<TFamily> },
    _optionalArgs: Record<string, never> = {},
  ): ToolRegistration[] {
    return sources.flatMap((source) =>
      buildDomainRegistrations({ metadata: catalog.metadata,
        domain: catalog.domain,
        catalogModule: catalog.catalogModule,
        catalog: indexCatalogById({ catalog: [capabilityCatalogEntry(source)] }),
        handlers: { [source.id]: capabilityToolHandler(source, deps) },
        derivedRisk: pluginCapabilityToolDerivedRisk({ sources: [source] }),
      }).map((registration) => applyApprovalPolicy({ registration: withActivationGate(registration, deps, source.pluginId), family: approvalFamily })),
    );
  }

  /** Product authorization and approval inputs for Jini's executable registration owner. */
  function executablePluginToolPorts({ deps, contributions }: { deps: Deps; contributions: PluginContributionRegistry }): PluginToolContributionPorts {
    // The caller passes the bound registry it just checked, so there is no unbound case to refuse here.
    return {
      contributions,
      isEnabled: async ({ pluginId }) => (await deps.pluginActivationRepo.getActivation({ workspaceId: deps.workspaceId, pluginId }))?.enabled === true,
      resolveAuth: async ({ pluginId, principalId }) => {
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId, permission: executableAccess.permission }, { entityType: executableAccess.entityType, entityId: pluginId });
        return { access: 'admin', principalId, workspaceId: deps.workspaceId };
      },
      // In-process arbitrary code can leave this site. Its prose cannot self-classify it as read-only.
      // The assistant decides when to invoke it; only permanent-delete tools require confirmation.
      metadata: executableAccess.metadata,
    };
  }

  /**
   * Composition-root entry point: loads every enabled, field-declaring plugin for one workspace and
   * registers each as a real tool directly on `registry` — the same `registry.register(registration)`
   * call `agent-daemon-server.ts`'s own loops make for every other contributor's output, just awaited
   * first (mirrors `registerInstalledAgentPluginTools`'s identical shape and rationale).
   *
   * @throws Whatever `registry.register()` itself throws on an id collision (`@jini-ai/core`'s
   * `createToolRegistry()` throws synchronously — see this file's header) — deliberately not caught
   * here; the caller's own fail-open `try/catch` (matching `registerInstalledAgentPluginTools`'s and
   * `registerInstalledSkillTools`'s call sites in `agent-daemon-server.ts`) is where that is handled,
   * so all three optional registrars degrade identically on failure.
   *
   * Registers with the per-call activation gate, so a tool this puts into the daemon's registry is
   * refused the moment its plugin is disabled, quarantined or uninstalled.
   */
  async function registerEnabledPluginCapabilityTools(
    { registry, deps, applyApprovalPolicy }: { registry: PluginCapabilityRegistryPort; deps: Deps & PluginCapabilitySourceDeps; applyApprovalPolicy: PluginCapabilityApprovalPort<TFamily> },
    _optionalArgs: Record<string, never> = {},
  ): Promise<void> {
    const sources = await loadEnabledPluginCapabilityToolSources(deps);
    for (const registration of buildPluginCapabilityToolRegistrations({ sources, deps, applyApprovalPolicy })) {
      registry.register(registration);
    }
    if (deps.pluginContributions && (deps.executablePluginToolRegistry || (registry.has && registry.list))) {
      attachPluginContributionTools({ ...executablePluginToolPorts({ deps, contributions: deps.pluginContributions }), registry: deps.executablePluginToolRegistry ?? registry as ToolRegistry });
    }
  }

  return {
    loadSources: (deps) => loadEnabledPluginCapabilityToolSources(deps),
    buildRegistrations: (args) => buildPluginCapabilityToolRegistrations(args),
    registerEnabled: (args) => registerEnabledPluginCapabilityTools(args),
  };
}

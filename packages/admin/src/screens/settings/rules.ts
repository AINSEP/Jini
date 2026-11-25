import type { ByokConfig, ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { type Translate } from "@jini-ai/core/text";
import type { KitSaveState, SourceFieldSpec, SourceFieldValues } from "../../react/kit-ui-types.js";

const identityTranslate: Translate = (key) => key;

/**
 * @file Pure logic for the `settings` feature (the settings dialog) —
 * everything that computes a value rather than rendering one.
 *
 * Named `rules.ts` to match `features/posts/rules.ts`'s (and the since-deleted
 * `features/settings-raw/rules.ts`'s) convention: the slice's decisions live in one importable,
 * directly testable module with no React in it.
 *
 * `SettingsUi.tsx` mounts six independent `useSettingsSlice` instances (Execution, Instructions,
 * Notifications, Privacy, Dialog appearance, Language); the functions below all operate on that
 * homogeneous `{ value, loadError, saveState }` shape rather than on any one slice's own type, so
 * they don't need to know which of the six they're being called with.
 *
 * `mergeSourceUpdate` below serves a different hook in this same feature
 * (`hooks/use-external-mcp.hooks.ts`'s `updateSource`) — landed here rather than a second file
 * because it is the same "pure decision, no React, directly testable" shape as everything else in
 * this module, just for a different screen within `settings`.
 */

/** The subset of `SourceConfigItem`'s shape {@link mergeSourceUpdate} actually reads — kept
 *  narrow and local rather than importing `@jini-ai/ui`'s full `SourceConfigItem` type here, so
 *  this module stays free of that package's own type surface. */
interface PreviousSourceFields {
  fields?: Record<string, string>;
  enabled?: boolean;
  label?: string;
}

/** Mirrors the shape `use-external-mcp.hooks.ts`'s local `SourceUpdateInput` type describes (a
 *  partial patch: `fields`/`enabled`/`label`, each optional). */
interface SourceUpdatePatch {
  fields?: Record<string, string>;
  enabled?: boolean;
  label?: string;
}

/** What `updateSource` sends to `toWriteBody` — the merged result of a partial patch over the
 *  last-known values for a source that a write route replaces wholesale (see
 *  `use-external-mcp.hooks.ts`'s own comment on `lastKnown` for why the merge is needed at all:
 *  the route replaces the whole row, so an unmerged patch would blank out every field it doesn't
 *  mention). */
export interface MergedSourceUpdate {
  fields: Record<string, string>;
  enabled: boolean;
  label: string | undefined;
}

/**
 * `updateSource`'s own decision, pulled out to a top-level pure function per the 2026-08-12
 * complexity-ceiling pass: every `?.`/`??` in the three merged fields below is its own branch under
 * ESLint's `complexity` rule, and moving them out of `updateSource`'s own scope is what actually
 * lowers that function's score (unlike a switch, where moving CASE BODIES out doesn't reduce the
 * case count — this is a flat expression, so extracting the whole computation removes the branches
 * entirely from the caller). Also now directly testable with plain object literals, no port, no
 * `useRef`, no `await`.
 *
 * @complexity Time/space: O(k) in the patch's own field count — one shallow merge, no iteration.
 */
export function mergeSourceUpdate({ previous, patch }: { previous: PreviousSourceFields | undefined; patch: SourceUpdatePatch }, _options = {}): MergedSourceUpdate {
  return {
    fields: { ...(previous?.fields ?? {}), ...(patch.fields ?? {}) },
    enabled: mergeEnabled({ previous, patch }),
    label: patch.label ?? previous?.label,
  };
}

/** A patch's `enabled` wins, then the stored one; a source nobody has toggled yet is on. */
function mergeEnabled({ previous, patch }: { previous: PreviousSourceFields | undefined; patch: SourceUpdatePatch }, _options: Record<string, never> = {}): boolean {
  return patch.enabled ?? previous?.enabled ?? true;
}

// ---------------------------------------------------------------------------
// External MCP: reactive field specs for transport + auth mode
// ---------------------------------------------------------------------------
//
// `@jini-ai/ui`'s `SourceFieldSpec[]` is a flat, non-reactive array — the generic primitive has no
// concept of "hide this field unless that other field has this value" (see `types.ts`'s own
// `SourceFieldSpec` doc: `required` is a plain boolean, not a predicate). Rather than teach that
// generic package a host-specific notion of conditional fields, the spec ARRAY ITSELF is recomputed
// here, in the host, from the draft's current values — a field simply isn't in the array when it doesn't
// apply, which means it is neither rendered (`SourceConfigAddForm`/`SourceConfigItemCard` only ever
// map over what they're given) nor validated (`validateSourceDraft` only ever iterates what it's
// given). `ExternalMcpSettingsPanel.tsx` is what makes the recomputation live as the operator types —
// this module stays the pure decision, same split as the rest of this file.

/** A server is `stdio` unless it explicitly says `streamable_http` — the same default
 *  `parseExternalMcpPutBody` applies server-side, restated here so the add form shows the SAME
 *  set of required/visible fields a freshly-opened, not-yet-touched draft would actually save as.
 *  @complexity O(1). */
export function resolveExternalMcpEffectiveTransport(values: SourceFieldValues, _optional: Record<string, never> = {}): "stdio" | "streamable_http" {
  return values.transport === "streamable_http" ? "streamable_http" : "stdio";
}

/** A server is `static_env` unless it explicitly says `none` or `oauth` — mirrors
 *  `resolveExternalMcpAuthMode`'s server-side default for the identical reason
 *  {@link resolveExternalMcpEffectiveTransport} does. @complexity O(1). */
export function resolveExternalMcpEffectiveAuthMode(values: SourceFieldValues, _optional: Record<string, never> = {}): "none" | "static_env" | "oauth" {
  if (values.authMode === "none") return "none";
  if (values.authMode === "oauth") return "oauth";
  return "static_env";
}

function buildExternalMcpIdentityFieldSpecs({ t }: { t: Translate }): SourceFieldSpec[] {
  const specs: SourceFieldSpec[] = [
    { key: "id", label: t("ID"), kind: "text", required: true, placeholder: t("lowercase letters, digits and dashes") },
    {
      key: "transport",
      label: t("Connection type"),
      kind: "select",
      required: true,
      options: [
        { value: "stdio", label: t("Local command (stdio)") },
        { value: "streamable_http", label: t("Hosted server (URL)") },
      ],
    },
    // Third, right under Connection type (owner call, 2026-09-13): how the connection authenticates
    // decides which of the fields below apply at all, so it is chosen before them, not after.
    {
      key: "authMode",
      label: t("Credentials"),
      kind: "select",
      required: true,
      options: [
        { value: "none", label: t("None needed") },
        { value: "static_env", label: t("API key / access token") },
        { value: "oauth", label: t("Connect via OAuth") },
      ],
    },
  ];

  return specs;
}

/**
 * Builds the field-spec list a draft's CURRENT `transport`/`authMode` values imply.
 *
 * Order matters for both forms this feeds: connection identity first, then how to reach it
 * (transport-specific), then how to authenticate (auth-mode-specific) — an operator reads the form
 * top to bottom in the order they'd naturally think through setting up a connection.
 *
 * @param values - The draft's current field values (or a saved item's `fields`, for the edit card).
 * @returns The specs to render AND validate against for these values — nothing else exists to the
 * form once this returns; see this module's own section header for why that is the whole mechanism.
 * @complexity O(1) — a fixed, bounded number of conditionally-included entries.
 */
export function buildExternalMcpFieldSpecs(values: SourceFieldValues, { t = identityTranslate }: { t?: Translate } = {}): SourceFieldSpec[] {
  const transport = resolveExternalMcpEffectiveTransport(values);
  const authMode = resolveExternalMcpEffectiveAuthMode(values);
  const isStdio = transport === "stdio";
  const isOAuth = authMode === "oauth";

  const specs = buildExternalMcpIdentityFieldSpecs({ t });

  if (authMode === "static_env") specs.push(...buildAccessTokenFieldSpecs({ isStdio, t }));

  if (isStdio) {
    specs.push(
      { key: "command", label: t("Command"), kind: "text", required: true, placeholder: t("e.g. npx, node, /path/to/binary") },
      { key: "args", label: t("Args"), kind: "text", placeholder: t("space-separated") },
    );
  } else {
    specs.push({ key: "url", label: t("URL"), kind: "text", required: true, placeholder: t("https://…") });
  }

  specs.push({
    key: "allowedToolNames",
    label: t("Allowed tools"),
    kind: "text",
    placeholder: t("Comma-separated. The assistant can call only these tools."),
  });

  // Unconditional, same as `allowedToolNames` immediately above: `trust.ts` R2/R3 apply this pair
  // regardless of transport or auth mode — a remote tool declaring `readOnlyHint: false` is refused
  // unless the operator has named it here, and that check does not care how the connection is
  // reached or authenticated. See `mergeSourceUpdate`'s neighboring header comment and this
  // module's own top-of-section note for why the spec array itself (not a hidden/disabled flag) is
  // how a field is shown or withheld here.
  specs.push({
    key: "writeAllowedToolNames",
    label: t("Allowed to make changes"),
    kind: "text",
    placeholder: t("comma-separated — a tool can change or create things only if it's listed both here and in Allowed tools above"),
  });

  if (isStdio) {
    specs.push({
      key: "env",
      label: t("Environment variables (KEY=VALUE)"),
      kind: "textarea",
      placeholder: t("API_TOKEN=…  (leave blank to keep the stored values)"),
    });
  }

  if (isOAuth) specs.push(...buildOAuthFieldSpecs({ isStdio, t }));

  return specs;
}

/**
 * The `static_env` ("API key / access token") field specs, right under Credentials.
 *
 * `accessToken` is a `password` field and write-only, like `oauthClientSecret`: the server seals it
 * and never returns it, so it always arrives blank and blank means "keep the stored token". A local
 * command receives it as an environment variable, so stdio also asks WHICH variable; a hosted server
 * receives it as `Authorization: Bearer`, so it needs no name. Neither is `required` here: a
 * connection may keep a token it already stores, and the server rejects a stdio token with no
 * variable name itself.
 *
 * @complexity O(1).
 */
function buildAccessTokenFieldSpecs({ isStdio, t }: { isStdio: boolean; t: Translate }, _options = {}): SourceFieldSpec[] {
  const specs: SourceFieldSpec[] = [
    { key: "accessToken", label: t("Access token"), kind: "password", placeholder: t("leave blank to keep the stored token") },
  ];
  if (isStdio) {
    specs.push({
      key: "accessTokenEnvName",
      label: t("Access token environment variable"),
      kind: "text",
      placeholder: t("the variable the command reads its token from, e.g. API_TOKEN"),
    });
  }
  return specs;
}

function buildOAuthClientFieldSpecs({ isStdio, t }: { isStdio: boolean; t: Translate }): SourceFieldSpec[] {
  const specs: SourceFieldSpec[] = [
    {
      key: "oauthProviderId",
      label: t("Provider ID"),
      kind: "text",
      placeholder: t("leave blank to define this connection's own endpoints below"),
    },
    {
      key: "oauthGrant",
      label: t("Sign-in method"),
      kind: "select",
      options: [
        { value: "authorization_code", label: t("Browser sign-in") },
        { value: "device_code", label: t("Device code") },
      ],
      // Required only for stdio, same discovery precedent as `oauthClientId` right below: a
      // REMOTE connection can run RFC 8414 discovery against its own URL at connect time and read
      // the authorization server's own `grant_types_supported`, so an operator does not have to
      // guess between "Browser sign-in" and "Device code" before knowing what the server even
      // offers. A stdio connection has no URL to discover from, so there it stands.
      required: isStdio,
      ...(isStdio ? {} : { placeholder: t("detected from the server unless set here") }),
    },
    {
      key: "oauthClientId",
      label: t("Client ID"),
      kind: "text",
      // Required only for stdio, matching the server rule in `external-mcp-store.ts`: a REMOTE
      // connection can run OAuth discovery against its own URL and mint a client for itself by
      // RFC 7591 dynamic client registration, and a growing share of hosted MCP servers publish a
      // registration endpoint and no developer console — so for those there is no client id a
      // human could type. A stdio connection has no URL to discover from, so there it stands.
      required: isStdio,
      ...(isStdio ? {} : { placeholder: t("leave blank to register with this server automatically") }),
    },
    { key: "oauthClientSecret", label: t("Client secret"), kind: "password", placeholder: t("leave blank to keep the stored secret") },
    { key: "oauthScopes", label: t("Scopes"), kind: "text", placeholder: t("space- or comma-separated") },
  ];
  return specs;
}

/**
 * The OAuth-mode field specs — split out purely to keep {@link buildExternalMcpFieldSpecs} under the
 * shop's complexity ceiling, the same move this file's header describes for `mergeSourceUpdate`'s
 * 2026-08-12 pass: every field here shares one revealing condition (`authMode === 'oauth'`), so
 * extracting the whole block removes it from the caller's own branch count entirely, rather than
 * just relocating branches that would still be counted there.
 *
 * @complexity O(1) — a fixed, bounded number of conditionally-included entries.
 */
function buildOAuthFieldSpecs({ isStdio, t }: { isStdio: boolean; t: Translate }, _options = {}): SourceFieldSpec[] {
  const specs = buildOAuthClientFieldSpecs({ isStdio, t });
  if (isStdio) {
    specs.push({
      key: "oauthTokenEnvName",
      label: t("Access token environment variable"),
      kind: "text",
      required: true,
      placeholder: t("the variable name the command reads its token from"),
    });
  }
  specs.push(
    {
      key: "oauthAuthorizationEndpoint",
      label: t("Authorization endpoint"),
      kind: "text",
      placeholder: t("needed for Browser sign-in, unless Provider ID is set"),
    },
    { key: "oauthTokenEndpoint", label: t("Token endpoint"), kind: "text", placeholder: t("needed unless Provider ID is set") },
    {
      key: "oauthDeviceAuthorizationEndpoint",
      label: t("Device authorization endpoint"),
      kind: "text",
      placeholder: t("needed for Device code, unless Provider ID is set"),
    },
  );
  return specs;
}

// ---------------------------------------------------------------------------
// External MCP: agent handles
// ---------------------------------------------------------------------------
//
// `@jini-ai/ui`'s source-config components take ONE base handle each (`agentHandle`) and derive
// every sub-element's handle from it themselves — see that package's `agent-handles.ts`. the host's
// only job is to hand each mounted component a base, and to guarantee those bases are DISTINCT:
// two cards under one base publish duplicate `data-agent-element` values, which does not fail
// loudly — it silently makes `page.click`/`page.fill` ambiguous on whichever card the DOM happens
// to reach first.

/** The add form's base handle. Its own namespace, so no server id can ever collide with it. */
export const EXTERNAL_MCP_ADD_FORM_HANDLE = "mcp-add";

/** Every configured server's base handle starts here. Distinct from {@link EXTERNAL_MCP_ADD_FORM_HANDLE}. */
export const EXTERNAL_MCP_CARD_HANDLE_PREFIX = "mcp-server";

/**
 * A distinct, stable base handle for each configured server, in list order.
 *
 * Derived from the server's own id rather than its position, so an agent reading `find_elements`
 * sees `mcp-server-higgsfield-remove` and not `mcp-server-3-remove` — legibility is the whole
 * point of publishing handles at all. The slugify + uniqueness-by-suffix-search mechanics now live
 * in the shared {@link buildAgentListHandles} (extracted once a second list screen needed the
 * identical logic); this function is kept as the named, typed entry point this feature's own
 * callers and tests already use.
 *
 * @param sourceIds - The configured servers' ids, in the order they are rendered.
 * @returns One base handle per id, positionally aligned with `sourceIds`, all distinct.
 * @complexity See {@link buildAgentListHandles}.
 */
export function buildExternalMcpCardHandles({ sourceIds }: { sourceIds: readonly string[] }, _optional: Record<string, never> = {}): string[] {
  return buildAgentListHandles({ prefix: EXTERNAL_MCP_CARD_HANDLE_PREFIX, ids: sourceIds });
}

/**
 * The one cross-field OAuth rule `buildExternalMcpFieldSpecs`' per-field `required` flags cannot
 * express: a STDIO OAuth connection needs EITHER a registered provider id OR its own token endpoint,
 * not both — the same "OR", not "AND", `resolveOAuthProviderIdentity`/`assertOAuthProviderIdentity`
 * enforce server-side. Checked manually, the same way `useExternalMcp`'s `addSource` already checks
 * "An ID is required." before ever calling the API.
 *
 * A REMOTE connection is exempt, mirroring the same server-side exemption: it has a URL, so
 * `external-mcp-oauth.ts` can run RFC 9728 / RFC 8414 discovery against it at connect time and learn
 * the endpoints itself. Keeping the rule here for remote rows would re-close a path the server now
 * deliberately opens, and the admin tab is the operator's only route to it.
 *
 * @returns An operator-facing message when the rule is violated, else `null`.
 * @complexity O(1).
 */
export function validateExternalMcpOAuthIdentity(values: SourceFieldValues, { t = identityTranslate }: { t?: Translate } = {}): string | null {
  if (resolveExternalMcpEffectiveAuthMode(values) !== "oauth") return null;
  if (resolveExternalMcpEffectiveTransport(values) !== "stdio") return null;
  const hasProviderId = (values.oauthProviderId ?? "").trim() !== "";
  const hasTokenEndpoint = (values.oauthTokenEndpoint ?? "").trim() !== "";
  if (hasProviderId || hasTokenEndpoint) return null;
  return t("Enter a Provider ID, or fill in this connection's own Token endpoint.");
}

/** The subset of `SettingsSlice<T>` these functions actually read, kept generic-free so callers
 *  don't have to reconcile six different `T`s into one array type. */
export interface SliceLoadState {
  value: unknown;
  loadError: string | null;
}

/**
 * `SettingsUi`'s "everything resolved" gate. Every slice starts `null` and settles
 * independently; gating on the whole set keeps tabs from popping in one at a time as their
 * namespaces resolve.
 *
 * @complexity Time: O(n) in slice count; space: O(1).
 */
export function areAnySlicesLoading({ slices }: { slices: readonly SliceLoadState[] }, _optional: Record<string, never> = {}): boolean {
  return slices.some((slice) => slice.value === null);
}

/**
 * First load error across the mounted slices. One banner is enough — they all mean the same thing
 * to the operator (this screen is showing defaults), and one banner per slice would push the tabs
 * off the fold.
 *
 * @complexity Time: O(n) in slice count; space: O(1).
 */
export function firstLoadError({ slices }: { slices: readonly SliceLoadState[] }, _optional: Record<string, never> = {}): string | null {
  return slices.find((slice) => slice.loadError !== null)?.loadError ?? null;
}

/** Renders the merged save state as the status pill's text — the branch order (saving, then
 *  saved, then error's own message, then nothing) matches `mergeSaveStates`' own precedence, since
 *  this only ever runs on its output.
 *
 * @complexity Time/space: O(1).
 */
export function describeSaveStatus(save: KitSaveState, _optional: Record<string, never> = {}): string {
  if (save.status === "saving") return "Saving…";
  if (save.status === "saved") return "Saved";
  if (save.status === "error") return save.message;
  return "";
}

/**
 * `SettingsUi`'s own `byok` argument to `useAdminExecutionCredentialHook` — falls back to
 * the host's default `byok` (`defaultByok`) while `s.execution.value` is still `null` (see the call site's
 * own comment for why that fallback is harmless). Pulled out to a top-level pure function per the
 * same complexity-ceiling reasoning `mergeSourceUpdate` above documents: the `?.`/`??` here are
 * their own branches under ESLint's `complexity` rule, and moving this flat expression out of
 * `SettingsUi`'s own scope is what actually lowers its score.
 *
 * @complexity O(1).
 */
export function resolveByokConfig({ executionConfig, defaultByok }: { executionConfig: ExecutionConfig | null; defaultByok: ByokConfig }, _options = {}): ByokConfig {
  return executionConfig?.byok ?? defaultByok;
}

// ---------------------------------------------------------------------------
// External MCP: remove-confirmation copy
// ---------------------------------------------------------------------------
//
// An operator accidentally deleted a live, fully-configured OAuth connection by pressing the
// card's "Remove" — it deleted with no confirmation, and the sealed OAuth secret does not come
// back. `ExternalMcpRemoveConfirmDialog` gates that click on this copy; kept here rather than
// inline in the component, same "pure decision, no React" split as the rest of this file.

/** `ExternalMcpRemoveConfirmDialog`'s two pieces of copy — mirrors `LifecycleConfirmDialog`'s own
 *  `{ title, body }` shape in `features/collections/rules.ts`. */
export interface RemoveConfirmCopy {
  title: string;
  body: string;
}

/**
 * Names the server being removed in the title (an operator managing several connections must see
 * WHICH one they are about to lose, not a generic "Are you sure?"), and states what is actually
 * lost in the body: an OAuth connection's sealed credential cannot be recovered, so removing it
 * means reconnecting from scratch — the fact that would have saved an accidental delete from
 * costing an hour. A non-OAuth connection is still not restored by undo, but its credential (a
 * plain env var/API key the operator typed in) is at least something they can re-enter, not
 * something that has to be re-authorized.
 *
 * @complexity Time/space: O(1) — one ternary, no iteration.
 */
export function buildExternalMcpRemoveConfirmCopy(
  params: { name: string; isOAuth: boolean },
  { t = identityTranslate }: { t?: Translate } = {},
): RemoveConfirmCopy {
  return {
    title: t('Remove "{name}"?').replace("{name}", () => params.name),
    body: params.isOAuth
      ? t("This connection will stop working immediately. Its OAuth credential is sealed and cannot be recovered — reconnecting will require signing in again.")
      : t("This connection will stop working immediately. You'll need to re-enter its configuration to use it again."),
  };
}

/** Source ownership is supplied by the host API, never guessed from a connection's name. */
export function isBuiltInExternalMcpSource(
  { source }: { source: { fields: Record<string, string> } },
  _options = {},
): boolean { return source.fields.builtIn === "true"; }

/** Whether a saved OAuth row still needs the operator to sign in, which shows its Connect button.
 *  A row with no `oauthStatus` at all (a fake, or an older API) reads as signed in, so the button
 *  never appears on a guess. */
export function externalMcpNeedsSignIn(
  { source }: { source: { fields: Record<string, string> } },
  _options = {},
): boolean {
  const status = source.fields.oauthStatus;
  return resolveExternalMcpEffectiveAuthMode(source.fields) === "oauth" && status !== undefined && status !== "connected";
}

/**
 * Plain colour names for the admin appearance accent presets: each swatch's accessible name (a
 * screen reader used to hear "#7c3aed"); the hex stays in the swatch's tooltip. Keys are lower-case
 * hex. The presets' own English name keys come in through `presets`; `extraNames` adds any preset the
 * host defines on top of them. Build the table once rather than scanning on each render.
 */
export function buildAccentSwatchNames(
  { presets, extraNames = {} }: { presets: readonly { color: string; nameKey: string }[]; extraNames?: Readonly<Record<string, string>> },
  _options = {},
): Readonly<Record<string, string>> {
  return { ...Object.fromEntries(presets.map(({ color, nameKey }) => [color.toLowerCase(), nameKey])), ...extraNames };
}

/** A preset's English name key, or its hex for a colour the table doesn't know (a new upstream
 *  preset or a custom colour still gets a usable, if technical, name). @complexity O(1). */
export function accentSwatchName({ color, names }: { color: string; names: Readonly<Record<string, string>> }, _options = {}): string {
  return names[color.toLowerCase()] ?? color;
}

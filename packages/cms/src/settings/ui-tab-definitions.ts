import type { UUID } from "../core/ports.js";
import {
  ensureSettingDefinitions,
  type EnsureSettingDefinitionsDeps,
  type SettingDefinitionSpec,
} from "./ensure-definitions.js";
import { SCOPE_BIT } from "./types.js";

/**
 * @file Boot-time definition registration for the settings-dialog tabs that
 * need nothing but ledger storage — Instructions, Notifications, and Privacy.
 *
 * These three sit together because they are the same shape of problem, not
 * because they are the same domain: each is a `value` + `onChange` component
 * from a shared UI library with no async port, so the entire host-side cost
 * is "register some keys and map them". A tab that needs real backend work
 * (routes, a port) should keep its own module rather than accreting into
 * this one.
 *
 * All three read and write through the generic SPEC-007 ledger routes a host
 * exposes, gated by the ledger's own scope-derived `settings.workspace.write`
 * check. There is no bespoke get/set service and no per-tab permission — the
 * reason the shared `ensureSettingDefinitions` helper exists.
 */

/** Custom instructions applied to every admin-assistant conversation. */
export const INSTRUCTIONS_NAMESPACE = "core.instructions";

/** Completion-sound and desktop-notification preferences. */
export const NOTIFICATIONS_NAMESPACE = "core.notifications";

/** Telemetry consent state. */
export const PRIVACY_NAMESPACE = "core.privacy";

/** Theme choice and accent color for the settings-dialog surface. */
export const APPEARANCE_NAMESPACE = "core.appearance";

/** Admin UI locale. */
export const LANGUAGE_NAMESPACE = "core.language";

/**
 * "No consent decision recorded yet", which a host's UI layer may spell as
 * `privacyDecisionAt: null`.
 *
 * A literal `null` default is not registrable (see `SettingDefinitionSpec.
 * defaultValue` — non-secret definitions reject a null default outright), so
 * this needs a sentinel. `0` is safe rather than merely convenient: the field
 * is epoch milliseconds, and 0 is 1970-01-01, which cannot be a real decision
 * timestamp for software that did not exist then. The tab uses this exact
 * distinction — an unset value renders the first-run consent prompt, a set one
 * renders the "decided" state — so collapsing the two would silently re-prompt
 * an operator who has already chosen.
 */
const NO_DECISION_SENTINEL = 0;

/**
 * "No installation id", which a host's UI layer may spell as
 * `installationId: null` (its meaning: telemetry sharing is fully declined).
 * `""` is not a legal id — the tab generates opaque non-empty strings — so it
 * cannot collide with a real one.
 */
const NO_INSTALLATION_ID_SENTINEL = "";

type InstructionsKey = "custom";
type NotificationsKey = "soundEnabled" | "successSoundId" | "failureSoundId" | "desktopEnabled";
type PrivacyKey = "telemetry.metrics" | "telemetry.content" | "installationId" | "decisionAt";
type AppearanceKey = "theme" | "accentColor";
type LanguageKey = "locale";

interface KeyedSpec<K extends string> extends SettingDefinitionSpec {
  key: K;
}

const INSTRUCTIONS_DEFINITIONS: readonly KeyedSpec<InstructionsKey>[] = [
  // A host's `InstructionsTab` may collapse an all-empty textarea to `undefined` rather than `''`
  // (its `onChange` contract), so the adapter maps that back to this empty-string default instead
  // of storing a distinguishable "explicitly emptied" state the tab cannot itself produce.
  { key: "custom", schema: { type: "string" }, defaultValue: "" },
];

/**
 * Notification preferences are the one genuinely PER-OPERATOR surface in this
 * set, so they register `SCOPE_BIT.user` alongside `workspace` and the adapter
 * writes at user scope. Two admins sharing a workspace should not fight over
 * whether a completion sound plays on the other's machine — unlike a tab
 * whose backing resource is genuinely shared workspace state.
 *
 * The `workspace` bit stays in the mask so an operator with no user-scoped row
 * still inherits a workspace-level default rather than falling all the way
 * back to the registered one.
 */
const NOTIFICATIONS_SCOPES = SCOPE_BIT.user | SCOPE_BIT.workspace;

const NOTIFICATIONS_DEFINITIONS: readonly KeyedSpec<NotificationsKey>[] = [
  { key: "soundEnabled", schema: { type: "boolean" }, defaultValue: false, scopes: NOTIFICATIONS_SCOPES },
  // Free-form strings rather than an enum: sound ids are plain strings upstream and the catalog is
  // owned by a host's UI library. Pinning an enum here would make a package-side catalog addition
  // fail validation on an already-registered definition, which is a worse failure than accepting an
  // id the catalog no longer lists (the tab falls back to its own default for an unknown id).
  { key: "successSoundId", schema: { type: "string" }, defaultValue: "ding", scopes: NOTIFICATIONS_SCOPES },
  { key: "failureSoundId", schema: { type: "string" }, defaultValue: "buzz", scopes: NOTIFICATIONS_SCOPES },
  // Desktop notifications also need the BROWSER's Notification permission,
  // which is per-browser and not ours to store. This flag is only the
  // operator's intent; the tab reconciles it against the live permission.
  { key: "desktopEnabled", schema: { type: "boolean" }, defaultValue: false, scopes: NOTIFICATIONS_SCOPES },
];

const PRIVACY_DEFINITIONS: readonly KeyedSpec<PrivacyKey>[] = [
  // Both telemetry categories default OFF. A "consent state" type may type them optional, but
  // "unset" is carried by `decisionAt` instead — an operator who has decided has a timestamp, and
  // these two then mean exactly what they say.
  { key: "telemetry.metrics", schema: { type: "boolean" }, defaultValue: false },
  { key: "telemetry.content", schema: { type: "boolean" }, defaultValue: false },
  { key: "installationId", schema: { type: "string" }, defaultValue: NO_INSTALLATION_ID_SENTINEL },
  { key: "decisionAt", schema: { type: "number" }, defaultValue: NO_DECISION_SENTINEL },
];

/**
 * Appearance and Language are per-OPERATOR, same reasoning as Notifications:
 * which theme one admin looks at, and which language they read, are not
 * properties of the workspace. The `workspace` bit stays in the mask so an
 * operator with no user-scoped row still inherits a workspace default.
 */
const PER_OPERATOR_SCOPES = SCOPE_BIT.user | SCOPE_BIT.workspace;

const APPEARANCE_DEFINITIONS: readonly KeyedSpec<AppearanceKey>[] = [
  // Defaults to LIGHT rather than "system" here — a host whose surrounding admin UI is
  // light-only would put a dark panel inside a light app for every operator on a dark-mode
  // machine if this defaulted to following the OS. "system" stays selectable; a host can
  // override this default at its own registration call site if its UI has a real dark variant.
  {
    key: "theme",
    schema: { type: "enum", values: ["system", "light", "dark"] },
    defaultValue: "light",
    scopes: PER_OPERATOR_SCOPES,
  },
  // Free-form string rather than an enum over a swatch palette: a host's UI may ship a color
  // picker, so any `#rrggbb` is reachable, and its own accent-color normalizer already rejects
  // malformed values at render time. Pinning an enum here would reject a legitimate custom color
  // at the ledger.
  {
    key: "accentColor",
    schema: { type: "string" },
    defaultValue: "#2563eb",
    scopes: PER_OPERATOR_SCOPES,
  },
];

const LANGUAGE_DEFINITIONS: readonly KeyedSpec<LanguageKey>[] = [
  // A BCP-47-ish code, not an enum. The catalog of real locales is a host's own i18n concern, not
  // this library's; the tab takes a host-supplied `LocaleOption[]` and an unknown stored code
  // simply selects nothing rather than failing a ledger write.
  { key: "locale", schema: { type: "string" }, defaultValue: "en", scopes: PER_OPERATOR_SCOPES },
];

export interface EnsureSettingsUiTabDefinitionsInput {
  /** The trusted boot-time actor these writes are attributed to. */
  systemPrincipalId: UUID;
}

/**
 * Idempotently registers the Instructions, Notifications, and Privacy
 * definitions. Safe to call on every boot.
 *
 * @complexity O(n) in the total number of definitions (9), each a
 * skip-if-registered check plus at most one `registerDefinitions` call.
 */
export async function ensureSettingsUiTabDefinitions(
  deps: EnsureSettingDefinitionsDeps,
  input: EnsureSettingsUiTabDefinitionsInput,
): Promise<void> {
  const namespaces = [
    { namespace: INSTRUCTIONS_NAMESPACE, definitions: INSTRUCTIONS_DEFINITIONS },
    { namespace: NOTIFICATIONS_NAMESPACE, definitions: NOTIFICATIONS_DEFINITIONS },
    { namespace: PRIVACY_NAMESPACE, definitions: PRIVACY_DEFINITIONS },
    { namespace: APPEARANCE_NAMESPACE, definitions: APPEARANCE_DEFINITIONS },
    { namespace: LANGUAGE_NAMESPACE, definitions: LANGUAGE_DEFINITIONS },
  ];

  for (const { namespace, definitions } of namespaces) {
    await ensureSettingDefinitions(deps, {
      namespace,
      definitions,
      systemPrincipalId: input.systemPrincipalId,
    });
  }
}

/**
 * @file The curated list of setting keys an agent may write — the precondition
 * `agent-tools.ts`'s header names.
 *
 * ## Why this file has to exist before any settings write can be wired
 *
 * The generic setter (`settings_set`) is excluded from agent callability because there is no fixed,
 * curated list of named settings to wire tools against for a generic admin surface — an operator
 * can type any namespace string and edit any value through a raw editor. `ui-tab-definitions.ts`
 * changes that for one specific slice: it registers a fixed, statically-declared set of keys — each
 * with a schema, a default, and a scope mask — because the settings-dialog tabs need named keys to
 * bind to. This module is the subset of THAT list which is safe for an agent to write.
 *
 * The exclusion's sharpest objection was that schema validation "constrains the VALUE shape, not
 * WHICH key is targeted". That is exactly right about the generic setter, and exactly what
 * {@link AGENT_WRITABLE_PREFERENCE_IDS} fixes: it is published as a JSON Schema `enum`, so the
 * targeted key is constrained by the same mechanism that constrains everything else in the tool
 * surface. The two halves together are complete — this file bounds WHICH key, and the ledger's
 * own registered definition schema bounds the VALUE (`write-service.ts`'s `set()` validates
 * against it and rejects a mismatch before any write lands).
 *
 * So the generic setter stays excluded, permanently and for its original reason. This is the
 * curated alternative that exclusion explicitly pointed at, not a relaxation of it.
 *
 * ## What is deliberately NOT here
 *
 * `ui-tab-definitions.ts` registers 12 keys. Five are withheld:
 *
 * - **`core.privacy.telemetry.metrics` / `telemetry.content` / `decisionAt` / `installationId`** —
 *   a telemetry consent record whose entire purpose is to attest that a HUMAN decided. An agent
 *   writing it would not be recording a decision, it would be manufacturing one, and `decisionAt`
 *   is specifically the field the tab reads to know whether to stop asking. Withheld because the
 *   value means something different depending on who wrote it — the one property a curated
 *   allowlist cannot express.
 * - **`core.instructions.custom`** — the custom instructions prepended to every admin-assistant
 *   conversation. An agent writing this edits its own standing prompt for all future runs. That
 *   may well be worth allowing later, but it is a self-modification question and not a display
 *   preference, so it does not ride in on the same decision.
 *
 * Every key that IS here is a per-operator display preference: reversible in one call, scoped to
 * the caller's own user layer, and visible in the admin UI the moment it changes — which is what
 * makes the whole surface auditable by looking at it.
 *
 * ## Architectural role
 *
 * `settings` domain data. No I/O, no enforcement — `tool-registrations.ts` performs the
 * `authorize()` call and the write. Kept as data rather than inlined into the catalog so the tool
 * schema, the handler's dispatch, and the drift test all read the same source.
 */
import { SCOPE_BIT } from "./types.js";
import {
  APPEARANCE_NAMESPACE,
  LANGUAGE_NAMESPACE,
  NOTIFICATIONS_NAMESPACE,
} from "./ui-tab-definitions.js";

/**
 * One agent-writable preference.
 *
 * `namespace`/`key` are the ledger coordinates; `id` is the dotted form published to the model.
 * They are kept as separate fields rather than split from `id` at call time because a key may
 * itself contain dots (`telemetry.metrics` in the withheld privacy set proves the split is not
 * unambiguous), so deriving one from the other would be a latent bug the moment the allowlist grows.
 */
export interface AgentWritablePreference {
  /** The dotted `namespace.key`, published in the tool's `setting` enum. */
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  /**
   * Human-readable hint published alongside the enum, so a model knows what a legal value looks
   * like without a round trip. NOT a validator — the ledger's registered definition schema is the
   * only thing that accepts or rejects a value, and it is checked inside the write chokepoint.
   */
  readonly valueHint: string;
}

/**
 * The scope every write through this surface uses.
 *
 * `user`, always, and never operator-selectable. All seven keys register `user | workspace`
 * (`ui-tab-definitions.ts`'s `PER_OPERATOR_SCOPES` / `NOTIFICATIONS_SCOPES`), so `workspace` is
 * reachable in principle — and deliberately not offered. A workspace-scoped write changes the
 * inherited default for every operator who has no user-scoped row of their own, which is a write
 * whose blast radius the caller cannot see. The user layer affects exactly one person, and
 * `write-service.ts`'s `deriveRequiredPermission` gates it behind `settings.user.self.write`, the
 * narrowest write grant in the system, only because the target principal is left unnamed.
 */
export const AGENT_PREFERENCE_WRITE_SCOPE = "user" as const;

/**
 * Asserted by `__tests__/agent-writable-preferences.test.ts` against `ui-tab-definitions.ts`:
 * every id below must correspond to a definition that is actually registered AND whose scope mask
 * includes {@link SCOPE_BIT.user}. That test is the real guard on this file — an entry naming an
 * unregistered key would otherwise fail only at call time, as a runtime `DefinitionNotFoundError`
 * from inside the write chokepoint, on a tool the model had already been told it could call.
 */
export const AGENT_WRITABLE_PREFERENCES: readonly AgentWritablePreference[] = [
  {
    id: "core.language.locale",
    namespace: LANGUAGE_NAMESPACE,
    key: "locale",
    valueHint:
      "A BCP-47 language code the admin UI ships a translation for, e.g. 'en' or 'es'. An unrecognized code is stored but selects no option in the UI.",
  },
  {
    id: "core.appearance.theme",
    namespace: APPEARANCE_NAMESPACE,
    key: "theme",
    valueHint: "One of 'system', 'light', or 'dark'.",
  },
  {
    id: "core.appearance.accentColor",
    namespace: APPEARANCE_NAMESPACE,
    key: "accentColor",
    valueHint: "A hex color, e.g. '#2563eb'. Malformed values are rejected at render time.",
  },
  {
    id: "core.notifications.soundEnabled",
    namespace: NOTIFICATIONS_NAMESPACE,
    key: "soundEnabled",
    valueHint: "Boolean — whether a sound plays when an assistant run finishes.",
  },
  {
    id: "core.notifications.successSoundId",
    namespace: NOTIFICATIONS_NAMESPACE,
    key: "successSoundId",
    valueHint: "Sound id for a successful run, e.g. 'ding'. An unknown id falls back to the default.",
  },
  {
    id: "core.notifications.failureSoundId",
    namespace: NOTIFICATIONS_NAMESPACE,
    key: "failureSoundId",
    valueHint: "Sound id for a failed run, e.g. 'buzz'. An unknown id falls back to the default.",
  },
  {
    id: "core.notifications.desktopEnabled",
    namespace: NOTIFICATIONS_NAMESPACE,
    key: "desktopEnabled",
    valueHint:
      "Boolean — the operator's INTENT to receive desktop notifications. The browser's own Notification permission is separate and not settable from here.",
  },
];

const BY_ID: ReadonlyMap<string, AgentWritablePreference> = new Map(
  AGENT_WRITABLE_PREFERENCES.map((pref) => [pref.id, pref]),
);

/**
 * The `setting` enum published in the tool's input schema.
 *
 * Derived from {@link AGENT_WRITABLE_PREFERENCES} rather than written out a second time: a
 * hand-maintained copy is how an id ends up callable after being removed from the allowlist.
 *
 * @complexity O(n) once at module load.
 */
export const AGENT_WRITABLE_PREFERENCE_IDS: readonly string[] = AGENT_WRITABLE_PREFERENCES.map((p) => p.id);

/**
 * Resolves a model-supplied `setting` id to its ledger coordinates.
 *
 * Returns `undefined` for anything not on the allowlist — including ids the enum should already
 * have rejected. The redundancy is the point: the enum lives in a schema a caller validates
 * against, and this is the check that holds if that validation is ever bypassed, misconfigured, or
 * outrun by a stale published descriptor. A curated allowlist that is enforced in only one place
 * is enforced nowhere in particular.
 *
 * @param settingId - The dotted `namespace.key` from the tool input.
 * @returns The matching preference, or `undefined` if it is not agent-writable.
 * @complexity O(1).
 * @overallScore 100
 */
export function resolveAgentWritablePreference(settingId: string): AgentWritablePreference | undefined {
  return BY_ID.get(settingId);
}

/** Re-exported so the drift test can assert the scope mask without reaching into `types.ts` itself. */
export const AGENT_PREFERENCE_REQUIRED_SCOPE_BIT = SCOPE_BIT.user;

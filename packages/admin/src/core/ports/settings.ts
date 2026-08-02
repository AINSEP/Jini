/**
 * @file `AdminSettingsPort` — a layered settings ledger: global defaults, workspace overrides, and
 * per-user overrides on top of those, resolved to one effective value per key.
 *
 * ## Why three layers, and why `getSettingsEffective` returns the resolved view, not the raw layers
 *
 * A setting's effective value is whichever of `user` (most specific), `workspace`, or `global`
 * (least specific) has a value set, falling back to a compiled-in default when none do — that
 * resolution is exactly what `getSettingsEffective` returns per key via `SettingResolvedValue`'s
 * `sourceLayer`. There is deliberately no "list raw values across every layer" or "list every
 * registered definition" method on this contract: Tovu's own reference implementation does not
 * have those routes server-side either (only the 5 operations below shipped), so a panel that needs
 * to distinguish "the user override" from "everything else" composes two `getSettingsEffective`
 * calls — one with `principalId` set, one without — and diffs them. That is an application-level
 * technique, not something this port needs to special-case.
 *
 * ## `namespace` scopes every call
 *
 * Settings are grouped into namespaces (a plugin's own settings, a core feature's settings, ...);
 * every method here operates within exactly one namespace at a time, never across all of them.
 */

export type SettingScope = "global" | "workspace" | "user";

/** One key's fully-resolved effective value, as returned by `getSettingsEffective`. */
export interface SettingResolvedValue {
  readonly key: string;
  readonly value: unknown;
  /** Which layer actually supplied `value` — `"default"` means no layer had an override and this
   *  is the compiled-in fallback. */
  readonly sourceLayer: "user" | "workspace" | "global" | "default";
  /** Version of the setting's definition (validation rules, default) this value was resolved
   *  against — a host may use this to detect a stale client against a since-changed definition. */
  readonly defVersion: number;
}

/** The single value written or cleared, as returned by `setSetting`/`clearSetting`. */
export interface SettingValueResponse {
  readonly key: string;
  readonly scope: SettingScope;
  readonly value: unknown;
  /** Monotonic per-key revision counter — a host may use this for optimistic-concurrency or
   *  audit-ordering purposes. */
  readonly revisionSeq: number;
}

/** The outcome of clearing an entire namespace at one scope, as returned by
 *  `resetSettingsNamespace`. */
export interface SettingResetResponse {
  readonly namespace: string;
  readonly clearedCount: number;
  readonly revisionSeqs: readonly number[];
}

export interface AdminSettingsPort {
  /**
   * Resolved effective values for every key in `namespace`. Pass `principalId` to resolve as that
   * principal would see it (i.e. including their `user`-scope overrides); omit it to resolve
   * without any user layer — see the file header for the diff technique this enables.
   */
  getSettingsEffective(
    input: { namespace: string },
    options?: { principalId?: string },
  ): Promise<readonly SettingResolvedValue[]>;
  /** Writes one key at one scope. `options.principalId` is required when `input.scope === "user"`
   *  (there is no "current user" implied server-side) and ignored otherwise. */
  setSetting(
    input: { namespace: string; key: string; scope: SettingScope; value: unknown },
    options?: { principalId?: string },
  ): Promise<SettingValueResponse>;
  /** Removes one key's override at one scope, letting resolution fall through to the next layer
   *  down. Same `principalId` contract as `setSetting`. */
  clearSetting(
    input: { namespace: string; key: string; scope: SettingScope },
    options?: { principalId?: string },
  ): Promise<SettingValueResponse>;
  /** Clears every key in `namespace` at one scope in one call — the bulk counterpart to repeated
   *  `clearSetting` calls, and typically cheaper for a host to implement atomically. */
  resetSettingsNamespace(input: { namespace: string; scope: SettingScope }): Promise<SettingResetResponse>;
}

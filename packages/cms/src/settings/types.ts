import type { ISODateTime, JsonValue, UUID } from "../core/ports.js";

/**
 * @file Settings domain types.
 *
 * Purpose:
 * Record shapes + the schema-validation vocabulary shared by `settings.ts`,
 * `write-service.ts`, `purge-service.ts`, and both repo adapters. Interfaces
 * and types only — no feature logic (mirrors `identity/types.ts`).
 */

export type SettingScope = "global" | "workspace" | "user";
export type SettingOwnerKind = "core" | "site" | "theme";
export type DefinitionStatus = "active" | "alias" | "deprecated" | "tombstone";
export type ValueState = "set" | "cleared";
export type RevisionEntityKind = "definition" | "value";
export type RevisionOp =
  | "register"
  | "alias"
  | "retype"
  /**
   * A `core` definition's stored `default_json` was reconciled to the default
   * its source declares (`write-service.ts`'s `reconcileDefinitionDefault`).
   * Distinct from `retype`: the schema is unchanged, so no stored value needs
   * coercion and the definition version does NOT advance. Only unset-value
   * resolution changes.
   */
  | "redefault"
  | "deprecate"
  | "tombstone"
  | "set"
  | "clear"
  | "purge"
  | "coerce";

/** Scope bitmask values: global=1, workspace=2, user=4. Legal range 1..7. */
export const SCOPE_BIT = { global: 1, workspace: 2, user: 4 } as const;

/**
 * A deliberately small, total value-schema vocabulary (Article III — this
 * feature registers string/number/boolean/enum settings; a generic JSON
 * Schema engine is not needed and would be speculative generality). Every
 * variant is exhaustively validatable by `validateValue`.
 */
/**
 * `{type:"json"}` is a deliberately narrow, scalar-ADJACENT exception to the
 * "deliberately small" vocabulary above: it accepts any JSON value
 * (object/array/scalar) and validates nothing about its internal shape —
 * that is the registering feature's own write-path responsibility, never
 * this ledger's job.
 *
 * Enforcement rule that must survive any refactor: Code Review must confirm
 * that EVERY use is genuinely unbounded, list-shaped data with no scalar
 * decomposition available — it is not a general escape hatch for fields that
 * could be scalar-decomposed instead. The check is per-use, deliberately not
 * a headcount. See `docs/decisions/settings-json-schema-variant.md` for the
 * originating rationale and a related non-null-default invariant.
 */
export type SettingValueSchema =
  | { type: "string"; nullable?: boolean }
  | { type: "number"; nullable?: boolean }
  | { type: "boolean"; nullable?: boolean }
  | { type: "enum"; values: readonly string[]; nullable?: boolean }
  | { type: "json"; nullable?: boolean };

export interface SettingDefinitionRecord {
  settingId: UUID;
  version: number;
  /** NULL = platform def (core/theme); non-null = site-owned. */
  workspaceId: UUID | null;
  namespace: string;
  key: string;
  ownerKind: SettingOwnerKind;
  ownerId: string | null;
  schema: SettingValueSchema;
  defaultValue: JsonValue | null;
  /** Bitmask over `SCOPE_BIT`, legal range 1..7. */
  scopes: number;
  secret: boolean;
  status: DefinitionStatus;
  aliasOfNamespace: string | null;
  aliasOfKey: string | null;
  /** Present only when `version > 1`; a total coercer id/tag for the prior version. */
  coercionTag: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SettingValueRecord {
  settingId: UUID;
  scope: SettingScope;
  /** Present for workspace/user scope; null for global. */
  workspaceId: UUID | null;
  /** Present for user scope only. */
  principalId: UUID | null;
  valueJson: JsonValue | null;
  state: ValueState;
  defVersion: number;
  seq: number;
  updatedBy: UUID;
  updatedAt: ISODateTime;
  originPluginId: string | null;
}

export interface SettingRevisionRecord {
  seq: number;
  entityKind: RevisionEntityKind;
  settingId: UUID;
  scope: SettingScope | null;
  workspaceId: UUID | null;
  principalId: UUID | null;
  op: RevisionOp;
  beforeJson: JsonValue | null;
  afterJson: JsonValue | null;
  defVersion: number;
  actor: UUID;
  originPluginId: string | null;
  changeSetId: string | null;
  createdAt: ISODateTime;
}

/** The context a resolver/write call is evaluated against. */
export interface SettingScopeContext {
  workspaceId?: UUID | undefined;
  principalId?: UUID | undefined;
}

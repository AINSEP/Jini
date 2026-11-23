/**
 * @file Declarative plugin data-module grammar: column, index and table declarations, the module
 * declaration and its provenance. Types only (XP4); `@jini-ai/db` keeps the DDL engine.
 */

/**
 * @agent-note Saved format. The first declare that applies DDL stores these fields in
 * `_plugin_identity`; they are never updated. Later declares compare all three with strict string
 * equality, so a renamed publisher or moved URL is refused as `consent-required` the next time
 * that plugin has DDL to apply, unless both sides carry the same `signature`.
 */
export interface PluginProvenance {
  sourceUrl: string;
  publisher: string;
  signature?: string;
}

export type ColumnType = "TEXT" | "INTEGER" | "REAL" | "BLOB";
export type PluginTier = "tier-1" | "tier-2" | "tier-3";

export interface ColumnDecl {
  readonly name: string;
  readonly type: ColumnType;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
}

/**
 * Declared FKs / the SDK stress-test finding — the dataModule seam's
 * declared-index grammar. Comments' moderation-queue query pattern
 * (`workspace_id, entry_id, status`) is the concrete demand this grows the seam against, per
 * OQ-1's own instruction not to silently work around the gap. Deliberately NOT a foreign-key
 * declaration seam too — the original design says referential integrity to `entries`/parent
 * comments is "chokepoint-validated, not FK-enforced (v1)", so only indexes are the real,
 * load-bearing need; adding FK-declaration grammar with no consumer would be speculative.
 */
export interface IndexDecl {
  /** SHORT name; core prefixes it the same way tables are (`idx_p_{pluginId}__{name}`). */
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface TableDecl {
  /** SHORT name; core prefixes it with the reserved `p_{pluginId}__` namespace. */
  readonly name: string;
  readonly columns: readonly ColumnDecl[];
  readonly indexes?: readonly IndexDecl[];
  /** Share policy belongs to the table owner. Missing declarations still refuse nonempty data.
   * Portable columns are explicit so later personal fields cannot silently enter an archive. */
  readonly portability?: { readonly kind: "private" } | { readonly kind: "portable"; readonly columns: readonly string[] };
}

export interface DataModuleDecl {
  readonly pluginId: string;
  /** §3/T6: `dataModule` is scoped to Tier-2/Tier-3 only — a Tier-1 declaration is rejected. */
  readonly pluginTier: PluginTier;
  readonly tables: readonly TableDecl[];
  /** §5/§6/T5 — used by the namespace-adoption guard. */
  readonly provenance: PluginProvenance;
}

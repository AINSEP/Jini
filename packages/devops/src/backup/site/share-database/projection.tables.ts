import { warnCredentialContent, type CredentialWarning } from "../credential-warnings.js";

import { scheduler } from "node:timers/promises";
import { sql } from "kysely";
import { validateValueAgainstSchema, type SettingValueSchema } from "@jini-ai/core/settings";
import { createConsoleLogger, type Logger, type JsonValue } from "@jini-ai/core/primitives";

import { SiteShareRefusal, archiveRefusalName } from "../share-refusal.js";
import { listColumns, listTables } from "@jini-ai/db/kernel";

import { declareDataModule } from "@jini-ai/db/data-modules";
import type { DataModuleDecl, TableDecl } from "@jini-ai/core/contracts/site/db-data-modules";

import type { Row, Kernel, sanitizeShareDatabase } from "./projection.js";
import { mediaRowProjection, omitMediaReferences } from "./projection.media.js";

/** Build only present portable plugin tables through the existing trusted DDL owner.
 * Private tables contribute neither schema nor rows. O(declared tables + columns).
 * `modules` is the trusted bundled registry; tests pass their own typed declarations.
 * @throws SiteShareRefusal if the trusted declaration cannot be installed.
 */
export async function prepareSharePluginTables(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  target: Kernel; present: ReadonlySet<string>; modules: readonly DataModuleDecl[] }, optional: { logger?: Pick<Logger, "error"> } = {}): Promise<{ portable: Set<string>; private: Set<string> }> {
  const portable = new Set<string>();
  const privateTables = new Set<string>();
  for (const decl of required.modules) {
    const plan = sharePluginPlan({ decl, present: required.present });
    plan.portable.forEach(name => portable.add(name));
    plan.private.forEach(name => privateTables.add(name));
    if (plan.tables.length) await declarePortableTables({ host: required.host, target: required.target, decl, tables: plan.tables }, optional);
  }
  return { portable, private: privateTables };
}

/** One trusted declaration's share plan: its present portable tables trimmed to their policy
 * columns, and the physical names of its private tables (present or not). Pure; O(tables + columns).
 * @throws SiteShareRefusal when a portable policy names a column the table does not declare.
 */
function sharePluginPlan(required: { decl: DataModuleDecl; present: ReadonlySet<string> }, _options: Record<string, never> = {}): { tables: TableDecl[]; portable: string[]; private: string[] } {
  const plan: { tables: TableDecl[]; portable: string[]; private: string[] } = { tables: [], portable: [], private: [] };
  for (const table of required.decl.tables) {
    const name = `p_${required.decl.pluginId}__${table.name}`;
    const policy = table.portability;
    if (policy?.kind === "private") plan.private.push(name);
    if (policy?.kind !== "portable" || !required.present.has(name)) continue;
    plan.portable.push(name);
    plan.tables.push(portableColumnsOnly({ name, table, columns: policy.columns }));
  }
  return plan;
}

/** The table declaration narrowed to exactly its portable policy columns. O(columns × policy columns).
 * @throws SiteShareRefusal when the policy names a column the declaration lacks. */
function portableColumnsOnly(required: { name: string; table: TableDecl; columns: readonly string[] }, _options: Record<string, never> = {}): TableDecl {
  const columns = required.table.columns.filter(column => required.columns.includes(column.name));
  if (columns.length !== required.columns.length) throw new SiteShareRefusal({ code: "UNSUPPORTED_SCHEMA", message: `Invalid portable columns for '${required.name}': its portability policy names a column the table does not declare.` });
  return { ...required.table, columns };
}

/** Installs the trimmed portable tables through `declareDataModule`, the trusted DDL owner.
 * Logs the redacted declaration diagnostic; only the fixed refusal crosses the worker boundary.
 * @throws SiteShareRefusal when the owner refuses. O(declaration + diagnostic bytes). */
async function declarePortableTables(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  target: Kernel; decl: DataModuleDecl; tables: TableDecl[] }, { logger = createConsoleLogger({ prefix: "[site-share]" }) }: { logger?: Pick<Logger, "error"> } = {}): Promise<void> {
  const result = await declareDataModule({ db: required.target, dbPath: ":memory:", decl: { ...required.decl, tables: required.tables } });
  if (result.ok) return;
  // A typed refusal is written verbatim to refusal.txt, so native error text belongs only in logs.
  logger.error({ message: "Cannot build portable plugin schema" }, {
    meta: { diagnostic: required.host.redactSecretShapes({ text: result.error?.message ?? "Declaration refused" }).text },
  });
  throw new SiteShareRefusal({ code: "UNSUPPORTED_SCHEMA", message: `Cannot build portable plugin schema for '${required.decl.pluginId}': the bundled portable-data declaration could not be installed.` });
}

/** Refuse populated undeclared tables by name before any portable-row projection.
 * Never executes source DDL; `listTables` omits SQLite's own `sqlite_*` tables.
 * @throws SiteShareRefusal UNSUPPORTED_DATA with the table and required policy.
 * @complexity O(tables), with one bounded existence query per undeclared table.
 * @example await refuseUnknownShareTables({ source, trusted: new Set(await listTables(target)) });
 */
export async function refuseUnknownShareTables({ host, source, trusted }: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  source: Kernel; trusted: ReadonlySet<string> }, _options = {}): Promise<void> {
  for (const table of await listTables({ kernel: source })) {
    if (trusted.has(table) || host.SHARE_LEGACY_PRIVATE_TABLES.has(table) || host.CHAT_TABLE_NAMES.includes(table) || table.startsWith("_vault_backup_")) continue;
    const rows = await source.query<{ found: number }>(sql`SELECT 1 AS found FROM ${sql.id(table)} LIMIT 1`);
    if (rows.length) throw new SiteShareRefusal({ code: "UNSUPPORTED_DATA", message: `Cannot share unsupported nonempty table '${archiveRefusalName({ name: table })}'. Add an approved portable-data policy for this table first.` });
  }
}

// Only the additive Library/source columns may be absent in an older share. Never accept an
// archive's DDL. Plugin owners explicitly allow dropping fields outside their column policy.
const ADDITIVE_COLUMN_DEFAULTS: ReadonlyMap<string, Row> = new Map<string, Row>([
  ["media", { kind: "media", original_filename: null, source_metadata_json: null }],
  ["asset_blobs", { document_owned: 0 }],
]);

/** Refuses a source table whose columns differ from the trusted target schema: an extra source
 * column (unless a portable plugin table, whose extra fields are dropped) or a missing column with
 * no additive default. Pure; O(columns²) over two short column lists.
 * @throws SiteShareRefusal UNSUPPORTED_SCHEMA naming the table. */
function requireTrustedColumns(required: { table: string; columns: string[]; sourceColumns: string[]; defaults: Row }, { portablePlugin = false }: { portablePlugin?: boolean } = {}): void {
  const extra = !portablePlugin && required.sourceColumns.some(column => !required.columns.includes(column));
  const missing = required.columns.some(column => !required.sourceColumns.includes(column) && !Object.hasOwn(required.defaults, column));
  if (extra || missing) throw new SiteShareRefusal({ code: "UNSUPPORTED_SCHEMA", message: `Cannot share '${required.table}': its columns differ from the trusted current schema. Update the site first.` });
}

/** Copy rows using the trusted schema, preserving only explicit portable plugin columns.
 * Core extension columns still refuse; historical Library columns retain their trusted defaults.
 * O(rows × columns) projection/insertion; rows remain bounded by the snapshot cap.
 * @throws SiteShareRefusal for missing required columns or unapproved core columns.
 */
async function copyTable({ host, source, target, table, credentialWarnings }: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  source: Kernel; target: Kernel; table: string; credentialWarnings: CredentialWarning[] }, { signal, portablePlugin, omittedMediaIds = [] }: { signal?: AbortSignal; portablePlugin?: boolean; omittedMediaIds?: readonly string[] } = {}): Promise<void> {
  const columns = (await listColumns({ kernel: target, table })).map(row => row.name);
  const sourceColumns = (await listColumns({ kernel: source, table })).map(row => row.name);
  const defaults = ADDITIVE_COLUMN_DEFAULTS.get(table) ?? {};
  requireTrustedColumns({ table, columns, sourceColumns, defaults }, { portablePlugin });
  const rows = await source.run(db => db.selectFrom(table).select(columns.filter(column => sourceColumns.includes(column))).execute());
  const project = await mediaRowProjection({ host: host, target, table });
  const omitted = new Set(omittedMediaIds);
  for (const [index, sourceRow] of rows.entries()) {
    if (index % 1000 === 0) { await scheduler.yield(); signal?.throwIfAborted(); }
    const retained = omitMediaReferences({ row: { ...defaults, ...sourceRow }, table, omitted });
    if (!retained) continue;
    warnPortableRow({ host: host, row: retained, table, credentialWarnings });
    const row = project(retained);
    if (row) await target.run(db => db.insertInto(table).values(row).execute());
  }
}

/** Scan each portable column, preserving its exact text/BLOB bytes and identity. Only the
 * table/column leaves this boundary: row ids and matched values never enter diagnostics.
 * @complexity O(row bytes + accumulated warnings); mutates only the warning sink.
 */
function warnPortableRow(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  row: Row; table: string; credentialWarnings: CredentialWarning[] }, _options = {}): void {
  for (const [column, value] of Object.entries(required.row)) {
    const text = value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : value;
    if (typeof text === "string") warnCredentialContent({ path: `content.db:${required.table}.${column}`, text, credentialWarnings: required.credentialWarnings, redactSecretShapes: required.host.redactSecretShapes });
  }
}

/** Only explicitly portable definitions/workspace values travel. Credential-looking values are retained with warnings. */
async function copySettings({ host, source, target, credentialWarnings }: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  source: Kernel; target: Kernel; credentialWarnings: CredentialWarning[] }, _options = {}): Promise<void> {
  const definitions = await source.run(db => db.selectFrom("setting_definitions").selectAll().where("secret", "=", 0).where("status", "=", "active").execute());
  for (const definition of definitions) {
    const schema = portableDefinitionSchema({ host: host, definition });
    if (!schema) {
      continue;
    }
    warnPortableRow({ host: host, row: definition, table: "setting_definitions", credentialWarnings });
    await target.run(db => db.insertInto("setting_definitions").values(definition).execute());
    await copyWorkspaceValues({ host: host, source, target, definition, schema, credentialWarnings });
  }
}

/** The value schema of a definition that may travel — workspace-scoped, publishable,
 * with a default its own schema accepts — else null. O(definition text).
 * @throws SyntaxError when the stored schema or default is not JSON. */
function portableDefinitionSchema(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  definition: Row }, _options: Record<string, never> = {}): SettingValueSchema | null {
  const { definition } = required;
  if (!(Number(definition.scopes) & 2) || !Object.hasOwn(required.host.PUBLISHABLE_SETTINGS, `${definition.namespace}:${definition.key}`)) return null;
  const schema = JSON.parse(String(definition.schema_json)) as SettingValueSchema;
  const defaultValue = JSON.parse(String(definition.default_json)) as JsonValue;
  return validateValueAgainstSchema({ schema, value: defaultValue }) ? schema : null;
}

/** Copies the definition's current-version workspace values that may travel, stamped `share`.
 * O(values × value size). */
async function copyWorkspaceValues(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  source: Kernel; target: Kernel; definition: Row; schema: SettingValueSchema; credentialWarnings: CredentialWarning[] }, _options: Record<string, never> = {}): Promise<void> {
  const { definition } = required;
  const rows = await required.source.run(db => db.selectFrom("setting_values_workspace").selectAll().where("setting_id", "=", definition.setting_id).where("def_version", "=", definition.version).execute());
  for (const row of rows) {
    const portable = portableValue({ row, schema: required.schema });
    if (portable) warnPortableRow({ host: required.host, row, table: "setting_values_workspace", credentialWarnings: required.credentialWarnings });
    if (portable) await required.target.run(db => db.insertInto("setting_values_workspace").values({ ...row, value_json: JSON.stringify(portable.value), updated_by: "share" }).execute());
  }
}

/** The value one workspace row carries (null when cleared), or null when the row must be omitted:
 * a set value its schema rejects. O(value size).
 * @throws SyntaxError when a set value is not JSON. */
function portableValue(required: { row: Row; schema: SettingValueSchema }, _options: Record<string, never> = {}): { value: JsonValue } | null {
  const { row } = required;
  const value = row.state === "cleared" ? null : JSON.parse(String(row.value_json)) as JsonValue;
  if (row.state !== "cleared" && !validateValueAgainstSchema({ schema: required.schema, value })) return null;
  return { value };
}

/** Copy under one fresh-target transaction; private data and source search tables never enter it. */
export async function copyPortableTables(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  source: Kernel; target: Kernel; present: ReadonlySet<string>; plugins: { portable: ReadonlySet<string> }; credentialWarnings: CredentialWarning[]; omittedMediaIds?: readonly string[] }, optional: { signal?: AbortSignal } = {}): Promise<void> {
  const { source, target, present, plugins, credentialWarnings, omittedMediaIds } = required;
  await target.transaction(async () => {
    for (const table of required.host.SHARE_TABLES) {
      if (!present.has(table)) throw new SiteShareRefusal({ code: "UNSUPPORTED_SCHEMA", message: `Share requires current table '${table}'. Update this site first.` });
      await copyTable({ host: required.host, source, target, table, credentialWarnings }, { signal: optional.signal, omittedMediaIds });
    }
    for (const table of plugins.portable) await copyTable({ host: required.host, source, target, table, credentialWarnings }, { signal: optional.signal, portablePlugin: true });
    await copySettings({ host: required.host, source, target, credentialWarnings });
  });
}
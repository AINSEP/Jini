import { type CredentialWarning } from "../credential-warnings.js";
import type { ArchiveMediaCopy, ArchiveMediaSource, ArchiveMediaTransformParams } from "../archive-media.js";
import type { ShareDatabaseProjection as BaseShareDatabaseProjection } from "../share-preparation-steps.js";
import { statfs, writeFile } from "node:fs/promises";

import path from "node:path";

import type { StorageKernel, SqliteClient, ColumnInfo } from "@jini-ai/core/contracts/storage";
type SqliteConnectionSource = SqliteClient | { readonly $client: SqliteClient };
interface PostSearchHostConfig { searchConfig: string; projectionVersionSettingId: string }
import { SiteShareRefusal } from "../share-refusal.js";

import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";

import type { OwnedTempRootScope } from "../owned-temp-root.js";
export type ShareDatabaseProjection<TParams extends ArchiveMediaTransformParams = ArchiveMediaTransformParams> = BaseShareDatabaseProjection<ArchiveMediaSource<TParams>>;

import { prepareSharePluginTables, refuseUnknownShareTables, copyPortableTables } from "./projection.tables.js";
import { documentReferences, archiveMediaSources, rewriteMediaRows } from "./projection.media.js";
export { prepareSharePluginTables, refuseUnknownShareTables } from "./projection.tables.js";
export type Row = Record<string, unknown>;

/** Raw SQL statement built by the host's injected {@link ShareSqlTag}; `R` is the row type it yields. */
export interface RawStatement<R> { readonly isRawBuilder: true; readonly $rowType?: R }

/** The host's tagged-template SQL builder (a Kysely-compatible `sql` tag), injected through the host. */
export interface ShareSqlTag {
  <R = unknown>(strings: TemplateStringsArray, ...values: unknown[]): RawStatement<R>;
  /** Quotes an identifier (table or column name). */
  id(name: string): unknown;
}

/** Filterable, executable read built by {@link ShareQueryHandle.selectFrom}. Rows are schema-agnostic. */
export interface ShareSelectQuery {
  select(columns: string | readonly string[]): ShareSelectQuery;
  selectAll(): ShareSelectQuery;
  where(column: string, operator: "=", value: unknown): ShareSelectQuery;
  orderBy(column: string, direction: "asc" | "desc"): ShareSelectQuery;
  execute(): Promise<Row[]>;
}

/** Filterable, executable write (update/delete). */
export interface ShareMutationQuery {
  where(column: string, operator: "=", value: unknown): ShareMutationQuery;
  execute(): Promise<unknown>;
}

/** Upsert target for {@link ShareInsertQuery.onConflict}. */
export interface ShareConflictBuilder {
  columns(columns: readonly string[]): { doUpdateSet(values: Row): unknown };
}

/** Insert with optional upsert behaviour. */
export interface ShareInsertQuery {
  onConflict(build: (conflict: ShareConflictBuilder) => unknown): ShareInsertQuery;
  execute(): Promise<unknown>;
}

/** The structural slice of the host's query-builder handle the share projection uses. */
export interface ShareQueryHandle {
  selectFrom(table: string): ShareSelectQuery;
  insertInto(table: string): { values(row: Row): ShareInsertQuery };
  updateTable(table: string): { set(values: Row): ShareMutationQuery };
  deleteFrom(table: string): ShareMutationQuery;
}

export interface Kernel extends StorageKernel<ShareQueryHandle, unknown> {
  readonly transport: "better-sqlite3" | "pglite" | "node-postgres" | "pglite-socket";
  query<R>(statement: RawStatement<R>): Promise<R[]>;
  execute(statement: RawStatement<unknown>): Promise<void>;
}
/** Free-space probe for the private staging directory (`node:fs/promises` `statfs` by default). */
export type StagingSpacePort = (path: string) => Promise<{ bavail: number; bsize: number }>;

/**
 * Build a fresh database from a consistent snapshot through trusted bootstrap only. Source SQL,
 * triggers, search projections and migration rows are never copied. Queries and inserts use the
 * existing storage kernel; source FK order is replaced by the policy's parent-before-child order.
 * Source staging is private/read-only and always removed; the live database is never touched.
 * `searchHost` is the host's post-search binding (the same one live post search uses), so the
 * rebuilt projection keeps the host's search config and version-marker setting id.
 * @throws SiteShareRefusal for caps, unknown populated tables, or unsupported schema.
 * @complexity O(snapshot + portable rows) time/space, bounded to the v1 expanded cap.
 */
export async function sanitizeShareDatabase<TParams extends ArchiveMediaTransformParams = ArchiveMediaTransformParams>(required: { host: {
    deps: {
      listTables(required: { kernel: Kernel }, optional?: Record<string, never>): Promise<string[]>;
      listColumns(required: { kernel: Kernel; table: string }, optional?: Record<string, never>): Promise<ColumnInfo[]>;
      declareDataModule(required: { db: Kernel; dbPath: string; decl: DataModuleDecl }): Promise<{ ok: boolean; error?: { message?: string } }>;
      sqliteKernel(required: { source: SqliteConnectionSource }): Kernel;
      sqliteClientOf(required: { source: SqliteConnectionSource }): { serialize(): Buffer };
      sqliteConnectionOf(required: { kernel: Kernel }): { serialize(): Buffer } | undefined;
      closeSqliteConnection(required: { source: SqliteConnectionSource }): void;
    };
    SHARE_TABLES: readonly string[]; SHARE_LEGACY_PRIVATE_TABLES: ReadonlySet<string>; CHAT_TABLE_NAMES: readonly string[];
    PUBLISHABLE_SETTINGS: Readonly<Record<string, unknown>>; SHARE_LIMITS: { maxExpandedBytes: number };
    databaseCapMessage: string; insufficientStorageMessage: string;
    computeBlobStorageKey: (required: { workspaceId: string; sha256: string }) => string;
    documentContentType: (required: { filename: string }) => string;
    redactSecretShapes: import("../credential-warnings.js").CredentialRedactor;
    tempRoot: OwnedTempRootScope;
    openSqliteFileKernel: (required: { filePath: string }, optional?: { readOnly?: boolean }) => Kernel;
    openContentDb: (required: { filePath: string }) => SqliteConnectionSource;
    sql: ShareSqlTag;
    schemaErasedKernel(required: { store: SqliteConnectionSource }): StorageKernel<unknown, unknown>;
    backfillPostSearchIndex(required: { kernel: StorageKernel<unknown, unknown>; config: PostSearchHostConfig }, optional?: { batchSize?: number }): Promise<number>;
  };  snapshot: Buffer; omittedMediaIds?: readonly string[]; modules: readonly DataModuleDecl[]; searchHost: PostSearchHostConfig }, optional: { signal?: AbortSignal; statfs?: StagingSpacePort; tempRoot?: OwnedTempRootScope } = {}): Promise<ShareDatabaseProjection<TParams>> {
  optional.signal?.throwIfAborted();
  if (required.snapshot.length > required.host.SHARE_LIMITS.maxExpandedBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: required.host.databaseCapMessage });
  const credentialWarnings: CredentialWarning[] = [];
  return (optional.tempRoot ?? required.host.tempRoot)({ work: async ({ root: staging }) => {
    let source: Kernel | undefined;
    let fresh: SqliteConnectionSource | undefined;
    try {
      const filePath = path.join(staging, "snapshot.db");
      const space = await (optional.statfs ?? statfs)(staging);
      if (space.bavail * space.bsize < required.snapshot.length + 16 * 1024 * 1024) throw new SiteShareRefusal({ code: "INSUFFICIENT_STORAGE", message: required.host.insufficientStorageMessage });
      await writeFile(filePath, required.snapshot, { flag: "wx", mode: 0o600 });
      source = required.host.openSqliteFileKernel({ filePath }, { readOnly: true });
      fresh = required.host.openContentDb({ filePath: ":memory:" });
      const target = required.host.deps.sqliteKernel({ source: fresh });
      const from = source;
      const present = new Set(await required.host.deps.listTables({ kernel: from }));
      const plugins = await prepareSharePluginTables({ host: required.host, target, present, modules: required.modules });
      await refuseUnknownShareTables({ host: required.host, source, trusted: new Set([...await required.host.deps.listTables({ kernel: target }), ...plugins.private]) });
      await copyPortableTables({ host: required.host, source: from, target, present, plugins, credentialWarnings, omittedMediaIds: required.omittedMediaIds }, optional);
      await required.host.backfillPostSearchIndex({ kernel: required.host.schemaErasedKernel({ store: fresh }), config: required.searchHost });
      const documents = await documentReferences({ host: required.host, target });
      const media = [
        ...await target.run(db => db.selectFrom("asset_blobs").select(["storage_key as storageKey", "sha256"]).execute()) as { storageKey: string; sha256: string }[],
        ...await target.run(db => db.selectFrom("asset_renditions").select("storage_key as storageKey").execute()) as { storageKey: string }[],
      ];
      // Older shares included Trash/orphan sidecars. v2 emits only retained owners, so
      // arbitrary unreferenced archive media must refuse rather than be pruned on import.
      const bytes = required.host.deps.sqliteClientOf({ source: fresh }).serialize();
      return { bytes, media, documents, credentialWarnings, archiveMedia: await archiveMediaSources<TParams>({ target }) };
    } finally {
      await source?.close();
      if (fresh) required.host.deps.closeSqliteConnection({ source: fresh });
    }
  } });
}

/** Rewrites only the fresh share projection. No live DB or blob store is changed.
 * Rebuild sidecars so original and latest public point at the same copy; other renditions regenerate.
 * @throws SiteShareRefusal if copies do not cover the sanitized snapshot.
 * @complexity O(media + copies) indexed reads/writes, bounded by the share snapshot cap.
 */
export async function rewriteArchiveMedia(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  bytes: Buffer; copies: readonly ArchiveMediaCopy[] }, optional: { signal?: AbortSignal; tempRoot?: OwnedTempRootScope } = {}): Promise<Buffer> {
  return (optional.tempRoot ?? required.host.tempRoot)({ work: async ({ root: staging }) => {
    let target: Kernel | undefined;
    try {
      const file = path.join(staging, "content.db");
      await writeFile(file, required.bytes, { mode: 0o600, flag: "wx" });
      target = required.host.openSqliteFileKernel({ filePath: file });
      await rewriteMediaRows({ target, copies: required.copies, sql: required.host.sql }, optional);
      const connection = required.host.deps.sqliteConnectionOf({ kernel: target });
      if (!connection) throw new Error("Share database has no SQLite connection");
      const bytes = connection.serialize();
      return bytes;
    } finally { await target?.close(); }
  } });
}

export function createShareDatabaseProjection<TParams extends ArchiveMediaTransformParams = ArchiveMediaTransformParams>(required: {
  host: Parameters<typeof sanitizeShareDatabase>[0]["host"];
  archiveMediaTempRoot: OwnedTempRootScope;
}, _optional = {}) {
  const { host, archiveMediaTempRoot } = required;
  return {
    sanitizeShareDatabase: (input: Omit<Parameters<typeof sanitizeShareDatabase>[0], "host">, optional: Parameters<typeof sanitizeShareDatabase>[1] = {}) => sanitizeShareDatabase<TParams>({ ...input, host }, optional),
    rewriteArchiveMedia: (input: Omit<Parameters<typeof rewriteArchiveMedia>[0], "host">, optional: Omit<Parameters<typeof rewriteArchiveMedia>[1], "tempRoot"> = {}) => rewriteArchiveMedia({ ...input, host }, { ...optional, tempRoot: archiveMediaTempRoot }),
    prepareSharePluginTables: (input: Omit<Parameters<typeof prepareSharePluginTables>[0], "host">, optional: Parameters<typeof prepareSharePluginTables>[1] = {}) => prepareSharePluginTables({ ...input, host }, optional),
    refuseUnknownShareTables: (input: Omit<Parameters<typeof refuseUnknownShareTables>[0], "host">, optional: Parameters<typeof refuseUnknownShareTables>[1] = {}) => refuseUnknownShareTables({ ...input, host }, optional),
  };
}

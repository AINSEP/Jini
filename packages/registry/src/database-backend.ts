/**
 * @module database-backend
 *
 * A `RegistryBackend` backed by a `better-sqlite3` table: one row per entry
 * name, keyed by `(backendId, name)`, with the full {@link RegistryEntry}
 * stored as JSON. `list`/`search`/`resolve`/`doctor` reuse `StaticRegistryBackend`
 * by re-reading the whole table into an in-memory manifest snapshot on every
 * call (`getManifest()` override) — simple and correct for the entry counts a
 * registry realistically holds; `publish`/`yank` write straight to the table.
 */
import type Database from 'better-sqlite3';
import {
  RegistryEntrySchema,
  type RegistryEntry,
  type RegistryManifest,
  type RegistryPublishOutcome,
  type RegistryPublishRequest,
  type RegistryTrust,
  type RegistryYankOutcome,
} from '@injini/protocol';
import { assertValidPublishRequest, StaticRegistryBackend } from './static-backend.js';
import type { RegistryTrustRoot } from './trust.js';

type SqliteDb = Database.Database;

export interface DatabaseRegistryBackendOptions {
  id: string;
  trust?: RegistryTrust;
  db: SqliteDb;
  /** Optional `github-oidc` signature trust root — see `StaticRegistryBackendOptions.trustRoot`'s doc comment for what configuring (or omitting) this does. */
  trustRoot?: RegistryTrustRoot | undefined;
}

export class DatabaseRegistryBackend extends StaticRegistryBackend {
  readonly db: SqliteDb;

  constructor(options: DatabaseRegistryBackendOptions) {
    ensureRegistryTables(options.db);
    super({
      id: options.id,
      kind: 'db',
      trust: options.trust ?? 'restricted',
      manifest: manifestFromDb(options.db, options.id),
      trustRoot: options.trustRoot,
    });
    this.db = options.db;
  }

  async publish(request: RegistryPublishRequest): Promise<RegistryPublishOutcome> {
    // Validate the whole request against the wire schema before writing
    // anything: `manifestFromDb()`/`parseStoredEntry()` throw on read for
    // any row that fails `RegistryEntrySchema`, so an unvalidated publish
    // could write a row that permanently breaks every future
    // `list`/`search`/`resolve`/`doctor` call for this backend (see CR-009 /
    // `assertValidPublishRequest`'s docs in `static-backend.ts`).
    const parsed = assertValidPublishRequest(request);
    const [vendor, name] = parsed.entry.name.split('/');
    const changedFiles = [
      `db://${this.id}/entries/${vendor}/${name}`,
      `db://${this.id}/entries/${vendor}/${name}/versions/${parsed.entry.version}`,
    ];
    // A dry-run publish must not mutate the database — only report what
    // *would* change — and must say so honestly in the outcome.
    if (parsed.dryRun) {
      return { ok: true, dryRun: true, changedFiles, warnings: [] };
    }
    upsertRegistryEntry(this.db, this.id, parsed.entry);
    return { ok: true, dryRun: false, changedFiles, warnings: [] };
  }

  async yank(name: string, version: string, reason: string): Promise<RegistryYankOutcome> {
    // Read-then-write: run as a single `IMMEDIATE` transaction rather than
    // two separate auto-committing statements. Two bare statements leave a
    // window — between the SELECT and the later UPSERT — where a concurrent
    // writer (a second connection/process sharing this database file, e.g.
    // another daemon instance) can commit a change to the same row; this
    // yank would then compute `nextVersions` from stale data and silently
    // clobber that concurrent change when it writes (a lost update).
    // `.immediate` acquires the write lock at the *start* of the
    // transaction, before the SELECT even runs, so a concurrent writer is
    // rejected for the whole operation instead of being able to interleave.
    const runYank = this.db.transaction((): RegistryYankOutcome => {
      const row = this.db
        .prepare(`SELECT entry_json FROM registry_entries WHERE backend_id = ? AND name = ?`)
        .get(this.id, name) as { entry_json: string } | undefined;
      if (!row) {
        return { ok: false, name, version, reason, warnings: [`${name} not found`] };
      }
      const entry = parseStoredEntry(row.entry_json, `${this.id}/${name}`);
      const versions = entry.versions ?? [{ version: entry.version, source: entry.source }];
      // Reject a yank of a version that never existed instead of reporting a
      // false success — mutating nothing while still returning `ok: true`
      // would let a caller believe a nonexistent version was suppressed.
      const exists = versions.some((item) => item.version === version);
      if (!exists) {
        return { ok: false, name, version, reason, warnings: [`${name}@${version} not found`] };
      }
      const nextVersions = versions.map((item) =>
        item.version === version ? { ...item, yanked: true, yankedAt: new Date().toISOString(), yankReason: reason } : item,
      );
      upsertRegistryEntry(this.db, this.id, {
        ...entry,
        versions: nextVersions,
        ...(entry.version === version ? { yanked: true, yankedAt: new Date().toISOString(), yankReason: reason } : {}),
      });
      return { ok: true, name, version, reason, warnings: [] };
    });
    return runYank.immediate();
  }

  protected override getManifest(): RegistryManifest {
    return manifestFromDb(this.db, this.id);
  }
}

/**
 * Create the `registry_entries` table if it does not already exist.
 *
 * @param db - The sqlite connection to migrate.
 */
export function ensureRegistryTables(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_entries (
      backend_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (backend_id, name)
    )
  `);
}

/**
 * Insert or update one registry entry's row for a given backend.
 *
 * @param db - The sqlite connection to write to.
 * @param backendId - The owning backend's id (part of the row's primary key).
 * @param entry - The entry to store (serialized as JSON).
 * @param now - Timestamp to record as `updated_at` (defaults to `Date.now()`).
 */
export function upsertRegistryEntry(db: SqliteDb, backendId: string, entry: RegistryEntry, now = Date.now()): void {
  db.prepare(`
    INSERT INTO registry_entries (backend_id, name, version, entry_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(backend_id, name) DO UPDATE SET
      version = excluded.version,
      entry_json = excluded.entry_json,
      updated_at = excluded.updated_at
  `).run(backendId, entry.name, entry.version, JSON.stringify(entry), now);
}

function manifestFromDb(db: SqliteDb, backendId: string): RegistryManifest {
  const rows = db
    .prepare(`SELECT entry_json FROM registry_entries WHERE backend_id = ? ORDER BY name ASC`)
    .all(backendId) as Array<{ entry_json: string; name: string }>;
  return {
    specVersion: '1.0.0',
    name: backendId,
    version: '0.0.0',
    entries: rows.map((row) => parseStoredEntry(row.entry_json, `${backendId}/${row.name}`)),
  };
}

/**
 * Parse and schema-validate a stored `entry_json` row. A row can only get
 * into this shape through `upsertRegistryEntry`'s own `JSON.stringify`, but
 * the table is a plain TEXT column any process/migration/manual edit can
 * corrupt — parsing it unchecked would crash every operation that reads the
 * table (`list`/`search`/`resolve`/`doctor`/`yank`) on the first bad row.
 * Fail with one clear, attributable error instead.
 *
 * @param raw - The raw `entry_json` column value.
 * @param context - `backendId/name` (or similar) included in the error for diagnosis.
 */
function parseStoredEntry(raw: string, context: string): RegistryEntry {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Corrupt registry_entries row (${context}): entry_json is not valid JSON.`, { cause });
  }
  const parsed = RegistryEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Corrupt registry_entries row (${context}): stored entry does not match RegistryEntrySchema: ${parsed.error.message}`);
  }
  return parsed.data;
}

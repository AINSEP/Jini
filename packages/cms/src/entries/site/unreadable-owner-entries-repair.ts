import type { TrashAdapter } from "../../trash/ports.js";

/**
 * @file The generic half of the unreadable-owner-entries boot repair: the predicate and the
 * classify-then-remove loop over rows the host has already selected. The host owns the marker
 * setting id, the lock key, the SQL that selects rows and writes the marker, the transaction, the
 * declared-owner map, which Trash adapter removes each type, and the log lines.
 *
 * Why it exists: on 2026-08-03 the generic entries route created two `widget` entries in production
 * with their payload under `fieldsJson.ext.site`. The widgets reader only reads `ext.widget`, so
 * nothing can ever parse them. Since 2026-10-04 the entries chokepoint reads the namespace off the
 * owning content type (`content-types/declared-owners.ts`), so no new ones can be written; this
 * removes the old ones. Owner decision 2026-10-04: a boot step that ships with the deploy, never a
 * hand edit of the production database.
 *
 * Safety: the predicate ({@link isMismatchedOwnerEnvelope}) is deliberately narrower than "unreadable".
 * Only types with a declared non-`site` owner are scanned, a trashed row is left to the Trash sweeper,
 * and a row is removed only when its `ext` has namespaces and none of them is the owner's. A row with
 * the owner's key present is never touched, even when malformed or carrying a stray namespace too.
 */

/** How a row was removed: through its registered Trash entry, or (no registration) directly. */
export type OwnerEntryRemovalVia = "trash-purge" | "hard-delete";

/** One removed row, as logged and recorded in the marker. */
export interface RemovedOwnerEntry {
  workspaceId: string;
  id: string;
  type: string;
  via: OwnerEntryRemovalVia;
}

/** The adapter that removes one type's rows (hide, then purge), and which path it is. */
export interface OwnerEntryRemoval {
  adapter: TrashAdapter;
  via: OwnerEntryRemovalVia;
}

/** One live `entries` row of a declared-owner type, as the host selected it. */
export interface OwnerEntryRow {
  id: string;
  workspace_id: string;
  type: string;
  version: number | string | bigint;
  fields_json: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `fieldsJson`'s envelope has at least one `ext` namespace and none of them is `owner`.
 * A missing or non-object envelope, or an empty `ext`, is not this defect and returns `false`.
 *
 * @complexity O(k) in the number of `ext` keys.
 */
export function isMismatchedOwnerEnvelope(required: { fieldsJson: unknown; owner: string }, _optional: Record<string, never> = {}): boolean {
  const { fieldsJson, owner } = required;
  if (!isPlainObject(fieldsJson) || !isPlainObject(fieldsJson.ext)) return false;
  const namespaces = Object.keys(fieldsJson.ext);
  return namespaces.length > 0 && !namespaces.includes(owner);
}

/** Parses a `fields_json` cell; `undefined` when it is not JSON (left alone, never removed). */
function parseFields({ raw }: { raw: string }, _options = {}): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Hides then purges one mismatched row, each step guarded by the version it classified; any refusal aborts the run. */
async function hideAndPurgeEntry(
  required: { row: OwnerEntryRow; removalFor: (type: string) => OwnerEntryRemoval; at: string },
  _optional = {}
): Promise<RemovedOwnerEntry> {
  const { row, removalFor, at } = required;
  const { adapter, via } = removalFor(row.type);
  const where = { workspaceId: row.workspace_id, entityId: row.id };
  const hidden = await adapter.hide({ ...where, at, expectedVersion: Number(row.version) });
  if (!hidden.ok) {
    throw new Error(`boot repair: entry ${row.id} (type ${row.type}) changed since it was classified (${hidden.reason}); nothing was removed, the next boot retries`);
  }
  const purged = await adapter.purge({ ...where, expectedVersion: hidden.version });
  if (purged !== "purged") {
    throw new Error(`boot repair: entry ${row.id} (type ${row.type}) was not purged (${purged}); nothing was removed, the next boot retries`);
  }
  return { workspaceId: row.workspace_id, id: row.id, type: row.type, via };
}

/**
 * Removes, in order, every row whose envelope does not match its type's declared owner. The host
 * runs this inside its own transaction and lock; any refusal throws so the whole run rolls back.
 *
 * @param required.rows - The live rows of the declared-owner types (host-selected, ordered).
 * @param required.owners - Content type to its declared envelope owner; a row of a type missing here throws.
 * @param required.removalFor - Which adapter removes a type.
 * @param required.at - The hide timestamp.
 * @complexity O(n) in `rows`; each removal O(1) adapter calls.
 */
export async function removeMismatchedOwnerEntries(
  required: { rows: readonly OwnerEntryRow[]; owners: Readonly<Record<string, string>>; removalFor: (type: string) => OwnerEntryRemoval; at: string },
  _optional: Record<string, never> = {}
): Promise<RemovedOwnerEntry[]> {
  const { rows, owners, removalFor, at } = required;
  const removed: RemovedOwnerEntry[] = [];
  for (const row of rows) {
    const owner = owners[row.type];
    if (owner === undefined) throw new Error(`Owner entry repair has no owner for type ${row.type}`);
    if (!isMismatchedOwnerEnvelope({ fieldsJson: parseFields({ raw: row.fields_json }), owner })) continue;
    removed.push(await hideAndPurgeEntry({ row, removalFor, at }));
  }
  return removed;
}

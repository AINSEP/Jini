import type { DurableJsonFile } from "./durable-json.js";

export interface DirectoryRecord {
  id: string; name: string; path: string; createdBy: string; lastOpened: string | null;
}
interface RegistryState { version: 1; entries: DirectoryRecord[]; migrations: string[]; }
export interface DirectoryRegistry {
  hasMigration(required: { migration: string }, options?: {}): boolean;
  migrations(required: Record<string, never>, options?: {}): string[];
  list(required: Record<string, never>, options?: {}): DirectoryRecord[];
  merge(required: { entries: readonly DirectoryRecord[]; migration?: string; migrations?: readonly string[] }, options?: {}): DirectoryRecord[];
  opened(required: { path: string; at: string }, options?: {}): void;
  remove(required: { path: string }, options?: {}): void;
  relocate(required: { from: string; to: string }, options?: {}): void;
}

/** Shared catalog: corrupt state fails closed; every update holds one durable file lock.
 * Canonical paths deduplicate symlink aliases. Identity collisions require explicit relocation.
 * Optional host admission prunes rejected entries on list under that same lock, then reports once.
 * @complexity O(n + m) records for merge, O(n) for other mutations, plus file I/O/lock wait.
 */
export function createDirectoryRegistry(
  // The catalog only reads, writes and locks; it never quarantines or stages temp files, so
  // transaction-local adapters need not stub those members.
  { file, canonicalPath }: { file: Pick<DurableJsonFile, "read" | "write" | "withLock">; canonicalPath: (required: { path: string }) => string }, { discard, reportDiscarded = () => {} }: {
    discard?: (required: { entry: DirectoryRecord }) => boolean;
    reportDiscarded?: (required: { entries: DirectoryRecord[] }) => void;
  } = {},
): DirectoryRegistry {
  function read(): RegistryState {
    const result = file.read({});
    if (result.state === "missing") return { version: 1, entries: [], migrations: [] };
    if (result.state !== "ok") throw new Error("The shared directory registry is unreadable; nothing was overwritten.");
    const state = result.value as RegistryState | null;
    if (state?.version !== 1 || !Array.isArray(state.entries) || !Array.isArray(state.migrations) ||
      !state.migrations.every((item) => typeof item === "string") || !state.entries.every(validRecord)) {
      throw new Error("The shared directory registry has an invalid format; nothing was overwritten.");
    }
    return state;
  }
  const canonical = (value: string) => canonicalPath({ path: value });
  const update = (change: (state: RegistryState) => RegistryState) => file.withLock({ critical: () => {
    const previous = read(), next = change(previous);
    if (JSON.stringify(next) !== JSON.stringify(previous)) file.write({ value: next });
  } });
  return {
    hasMigration: ({ migration }, _optional = {}) => read().migrations.includes(migration),
    migrations: (_required, _optional = {}) => read().migrations,
    list: (_required, _optional = {}) => {
      const current = read();
      if (!discard || !current.entries.some((entry) => discard({ entry }))) return current.entries;
      let entries = current.entries;
      let removed: DirectoryRecord[] = [];
      // Re-read under the same mutation lock; never overwrite a sibling process's new rows.
      update((state) => {
        removed = state.entries.filter((entry) => discard({ entry }));
        const discarded = new Set(removed);
        entries = state.entries.filter((entry) => !discarded.has(entry));
        return { ...state, entries };
      });
      if (removed.length) reportDiscarded({ entries: removed });
      return entries;
    },
    merge({ entries, migration, migrations = [] }, _optional = {}) {
      let result: DirectoryRecord[] = [];
      update((state) => {
        if (migration && state.migrations.includes(migration)) { result = state.entries; return state; }
        const byPath = new Map(state.entries.map((entry) => [canonical(entry.path), { ...entry, path: canonical(entry.path) }]));
        const byId = new Map([...byPath.values()].map((entry) => [entry.id, entry.path]));
        for (const entry of entries) mergeEntry({ entry, byPath, byId }, { canonical });
        result = [...byPath.values()];
        return { ...state, entries: result, migrations: [...new Set([...state.migrations, ...migrations, ...(migration ? [migration] : [])])] };
      });
      return result;
    },
    opened({ path, at }, _optional = {}) {
      if (!Number.isFinite(Date.parse(at))) throw new Error("The last-opened timestamp is invalid.");
      update((state) => ({ ...state, entries: state.entries.map((entry) => canonical(entry.path) === canonical(path) ? { ...entry, lastOpened: at } : entry) }));
    },
    remove({ path }, _optional = {}) {
      update((state) => ({ ...state, entries: state.entries.filter((entry) => canonical(entry.path) !== canonical(path)) }));
    },
    relocate({ from, to }, _optional = {}) {
      update((state) => {
        const target = canonical(to), source = canonical(from);
        if (state.entries.some((entry) => canonical(entry.path) === target && canonical(entry.path) !== source)) throw new Error("Relocation would overwrite a registered directory.");
        return { ...state, entries: state.entries.map((entry) => canonical(entry.path) === source ? { ...entry, path: target } : entry) };
      });
    },
  };
}

/** Fold one incoming record into the canonical path/identity maps of a merge in progress.
 * Refusals throw before either map changes, so the caller's update writes nothing.
 */
function mergeEntry({ entry, byPath, byId }: {
  entry: DirectoryRecord; byPath: Map<string, DirectoryRecord>; byId: Map<string, string>;
}, { canonical }: { canonical: (value: string) => string }): void {
  if (!validRecord(entry)) throw new Error("Cannot register an invalid directory record.");
  const dir = canonical(entry.path);
  const previous = byPath.get(dir);
  if (byId.has(entry.id) && byId.get(entry.id) !== dir) throw new Error(`Directory identity ${entry.id} is already registered at another path.`);
  // Reopening a site cannot reset who originally created it or its stable identity.
  const lastOpened = [previous?.lastOpened, entry.lastOpened].filter((at): at is string => typeof at === "string").sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  const next = previous ? { ...previous, name: entry.name, lastOpened } : { ...entry, path: dir };
  byPath.set(dir, next); byId.set(next.id, dir);
}
function validRecord(entry: unknown): entry is DirectoryRecord {
  if (!entry || typeof entry !== "object") return false;
  const row = entry as DirectoryRecord;
  return [row.id, row.name, row.path, row.createdBy].every((value) => typeof value === "string" && value.length > 0) &&
    (row.lastOpened === null || (typeof row.lastOpened === "string" && Number.isFinite(Date.parse(row.lastOpened))));
}

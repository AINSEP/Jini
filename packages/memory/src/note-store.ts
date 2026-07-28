/**
 * @module note-store
 *
 * A dependency-light, filesystem-backed markdown fact store: one markdown
 * file per entry (frontmatter `name`/`description`/`type` + a body), a
 * human-editable `INDEX.md` of bullet links that is the source of truth for
 * which entries are "active" (removing a bullet disables an entry without
 * deleting its file), a minimal on/off `.config.json`, and a change-event
 * stream so a host's UI/SSE layer can react to every write.
 *
 * Layout (under `<dataDir>/<config.subdir ?? 'notes'>/`):
 * ```
 * INDEX.md            — one bullet per active entry
 * <type>_<slug>.md    — per-entry body + frontmatter
 * .config.json        — { "enabled": true }
 * ```
 *
 * The entry-type taxonomy (`config.validTypes`/`config.defaultType`) is
 * entirely host-supplied — this module has no opinion on what a "type"
 * means beyond validating against the host's declared set.
 *
 * Filesystem safety invariants (see the 2026-07-21 backend security/code
 * review, findings CR-010/SEC-RB-004):
 *  - `config.subdir` must be a single safe path segment (no separators,
 *    no `.`/`..`); validated synchronously at construction.
 *  - Every operation re-resolves `<dataDir>/<subdir>` with `realpath` and
 *    verifies it is still contained under `realpath(dataDir)` before
 *    touching the filesystem, so a symlink planted after construction
 *    cannot redirect reads/writes/deletes outside the intended root.
 *  - Individual file reads reject symlinks (`lstat`-checked) rather than
 *    following them.
 *  - Entry/index/config writes go through write-to-temp-then-rename so a
 *    reader never observes a torn/partial file, and (because `rename`
 *    replaces the destination *name*, not whatever it points to) a
 *    pre-existing symlink at the destination path is atomically replaced
 *    rather than written-through.
 *  - Change-listener exceptions are isolated from the write path: a
 *    throwing listener cannot make an already-committed write look like a
 *    failed API call.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseEntryFrontmatter, renderEntryFrontmatter } from './entry-frontmatter.js';

export interface NoteStoreConfig {
  /** The entry-type buckets a host's notes may declare (host-owned taxonomy). */
  validTypes: readonly string[];
  /** Type substituted when a stored/patched type is missing or not in `validTypes`. */
  defaultType: string;
  /** Subdirectory under `dataDir` holding entries/index/config. Defaults to `'notes'`. Must be a single safe path segment. */
  subdir?: string;
}

export type NoteChangeKind = 'upsert' | 'delete' | 'index' | 'config';

export interface NoteChangeEvent {
  kind: NoteChangeKind;
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  source?: string;
  enabled?: boolean;
  at: number;
}

export interface NoteEntrySummary {
  id: string;
  name: string;
  description: string;
  type: string;
  updatedAt: number;
}

export interface NoteEntry extends NoteEntrySummary {
  body: string;
}

export interface NoteTreeNode {
  id: string;
  parentId: string | null;
  path: string;
  name: string;
  description: string;
  kind: 'folder' | 'entry';
  type: string;
  createdAt: string;
  updatedAt: string;
  childrenCount: number;
}

export interface NoteStoreOptions {
  enabled: boolean;
}

/**
 * Thrown by `readConfig`/`writeConfig` when the on-disk config cannot be
 * trusted (corrupt JSON, permission denied, or the store directory escapes
 * its data root) — deliberately distinct from "genuinely missing" (which
 * still defaults to `{ enabled: true }`), so a permission/corruption
 * failure cannot silently re-enable memory.
 */
export class NoteStoreConfigError extends Error {
  readonly code: string;
  constructor(message: string, code: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'NoteStoreConfigError';
    this.code = code;
  }
}

/** A configured note store bound to one type taxonomy; each `dataDir` passed to its methods is an independent store instance on disk. */
export interface NoteStore {
  readonly events: EventEmitter;
  dir(dataDir: string): string;
  deriveId(type: string, name: string): string;
  readConfig(dataDir: string): Promise<NoteStoreOptions>;
  writeConfig(dataDir: string, patch: Partial<NoteStoreOptions>): Promise<NoteStoreOptions>;
  readIndex(dataDir: string): Promise<string>;
  writeIndex(dataDir: string, body: string, options?: { silent?: boolean }): Promise<void>;
  listEntries(dataDir: string): Promise<NoteEntrySummary[]>;
  /**
   * The subset of `listEntries` whose id is linked in `INDEX.md` — the
   * user's hand-edited index is the source of truth for which entries are
   * "active"; removing a bullet disables that entry from a host's prompt/
   * context composition while leaving the file on disk.
   */
  listActiveEntries(dataDir: string): Promise<NoteEntrySummary[]>;
  readEntry(dataDir: string, id: string): Promise<NoteEntry | null>;
  upsertEntry(
    dataDir: string,
    input: { id?: string; name: string; description?: string; type: string; body?: string },
    options?: { silent?: boolean; source?: string },
  ): Promise<NoteEntry>;
  deleteEntry(dataDir: string, id: string): Promise<void>;
  updateTreeNode(
    dataDir: string,
    id: string,
    patch: { name?: string; description?: string; type?: string; body?: string },
  ): Promise<NoteEntry>;
  buildTree(dataDir: string): Promise<NoteTreeNode[]>;
}

const INDEX_FILE = 'INDEX.md';
const CONFIG_FILE = '.config.json';
const DEFAULT_INDEX = '# Notes\n\nOne bullet per active entry. Removing a bullet disables that entry from\nfuture reads; the underlying file stays on disk.\n\n';
// Name group tolerates backslash-escaped `]`/`[`/`(`/`)` (see `escapeIndexText`)
// so an escaped bracket/paren inside a rendered name doesn't terminate the
// match early; the href group is unaffected (link targets are always a
// validated `<id>.md`, which never contains `)`).
const INDEX_LINK_RE = /^\s*-\s+\[((?:\\.|[^\\\]])+)\]\(([^)]+)\)(\s+—\s+(.*))?$/;

function isValidId(id: string): boolean {
  return /^[a-z0-9_]+$/.test(id) && id.length <= 96;
}

/** A `config.subdir` must be exactly one safe, literal path segment — never a traversal or an absolute/rooted path. */
function assertSafeSubdir(subdir: string): void {
  if (typeof subdir !== 'string' || subdir.length === 0 || subdir.length > 128) {
    throw new Error('invalid note store subdir: must be a non-empty string of at most 128 characters');
  }
  if (subdir === '.' || subdir === '..') {
    throw new Error(`invalid note store subdir "${subdir}": must be a single path segment, not "." or ".."`);
  }
  if (subdir.includes('/') || subdir.includes('\\') || subdir.includes('\0')) {
    throw new Error(`invalid note store subdir "${subdir}": must not contain path separators`);
  }
  // Checked against `path.win32` unconditionally, not the platform-bound `path` import: a
  // drive-relative segment like `"C:foo"` has no `/`/`\` (so the check above doesn't catch it),
  // yet `path.win32.basename` strips the `"C:"` prefix (`path.win32.basename('C:foo') === 'foo'`)
  // — a real parse-ambiguity `@injini/sqlite`-adjacent code would only see on an actual Windows
  // host, if this were checked via the platform-bound `path` module instead. Using `path.win32`
  // explicitly makes this validation's outcome identical on every host OS this daemon might run
  // on, rather than silently depending on which platform happens to run it (`path.win32` is a
  // strict superset of `path.posix`'s own separator handling — accepting both `/` and `\` — so
  // this subsumes the POSIX check too, not just adds a Windows-only one).
  if (path.win32.basename(subdir) !== subdir || path.win32.isAbsolute(subdir)) {
    throw new Error(`invalid note store subdir "${subdir}": must be a single path segment`);
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

/**
 * Resolve `<dataDir>/<subdir>` and verify — via `realpath`, which follows
 * symlinks — that it is still contained under `realpath(dataDir)`. Rejects
 * a `subdir` (or an intermediate symlink) that redirects storage outside
 * the intended root. When `create` is true, the directory chain is created
 * first (matching the store's historical "writes create their directory"
 * behavior); read paths never create directories as a side effect.
 */
async function resolveContainedDir(lexicalDir: string, dataDir: string, create: boolean): Promise<string> {
  if (create) await ensureDir(lexicalDir);
  const realRoot = await fsp.realpath(dataDir);
  const realTarget = await fsp.realpath(lexicalDir);
  const rel = path.relative(realRoot, realTarget);
  const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!contained) {
    throw new Error(
      `note store: resolved directory "${realTarget}" escapes its data root "${realRoot}" (check the "subdir" option and for a symlink)`,
    );
  }
  return realTarget;
}

/** Reads a file only if it is a regular file (not a symlink/directory/device), rejecting via `lstat` rather than following. */
async function readRegularFileStrict(filePath: string): Promise<string> {
  const st = await fsp.lstat(filePath);
  if (!st.isFile()) {
    const err = new Error(`refusing to read non-regular-file path: ${filePath}`) as NodeJS.ErrnoException;
    err.code = 'ENOTREG';
    throw err;
  }
  return fsp.readFile(filePath, 'utf8');
}

/** Same regular-file guard as `readRegularFileStrict`, but reports "not found/unreadable" as `null` instead of throwing — for best-effort read paths. */
async function readRegularFileOrNull(filePath: string): Promise<{ raw: string; mtimeMs: number } | null> {
  let st;
  try {
    st = await fsp.lstat(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return { raw, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Write `data` to `filePath` via a same-directory temp file plus atomic
 * rename, so a concurrent reader or a crash mid-write never observes a
 * torn/partial file. Because `rename` replaces the destination *name*
 * rather than following it, this is also symlink-safe: if `filePath`
 * happened to be a pre-existing symlink, the rename atomically replaces
 * the symlink itself with the new regular file instead of writing through
 * it to whatever it pointed at.
 */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dirName = path.dirname(filePath);
  const tmpPath = path.join(
    dirName,
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const handle = await fsp.open(tmpPath, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Escapes a note name/description for safe embedding as Markdown link text
 * inside `INDEX.md`: newlines are collapsed to a space (an embedded
 * newline could otherwise inject an extra physical line that reads as a
 * new bullet), and `\`, `[`, `]`, `(`, `)` are backslash-escaped (standard
 * CommonMark literal-punctuation escaping) so embedded link syntax cannot
 * be interpreted as a second, attacker-controlled link/bullet by a
 * Markdown renderer or by this module's own `INDEX_LINK_RE` on a later
 * read.
 */
function escapeIndexText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\\[\]()]/g, (c) => `\\${c}`)
    .trim();
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Construct a note store bound to a host-supplied type taxonomy. Each
 * returned store carries its own `EventEmitter` — instantiate one store per
 * logical note collection rather than sharing a single process-wide emitter,
 * so unrelated stores in the same process never cross-fire events.
 *
 * @param config - The host's type taxonomy and storage subdirectory.
 * @returns A bound `NoteStore`.
 * @throws if `config.subdir` is not a single safe path segment.
 */
export function createNoteStore(config: NoteStoreConfig): NoteStore {
  const validTypes = new Set(config.validTypes);
  const subdir = config.subdir ?? 'notes';
  assertSafeSubdir(subdir);
  const events = new EventEmitter();
  events.setMaxListeners(64);

  function emitChange(event: Omit<NoteChangeEvent, 'at'>): void {
    // A throwing listener must not turn an already-committed write into an
    // apparent API failure — isolate listener exceptions from the caller.
    try {
      events.emit('change', { ...event, at: Date.now() });
    } catch {
      // Intentionally swallowed; see doc comment above.
    }
  }

  function isValidType(t: unknown): t is string {
    return typeof t === 'string' && validTypes.has(t);
  }

  function dir(dataDir: string): string {
    return path.join(dataDir, subdir);
  }

  function deriveId(type: string, name: string): string {
    const safeType = isValidType(type) ? type : config.defaultType;
    const raw = String(name || '');
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    if (cleaned.length > 0) return `${safeType}_${cleaned}`;
    // FNV-1a 32-bit on the original name — deterministic, dependency-free,
    // and avoids colliding two purely-non-ASCII names on the same fallback slug.
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < raw.length; i++) {
      h = (h ^ raw.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${safeType}_n${h.toString(36)}`;
  }

  async function containedEntryPath(dataDir: string, id: string, create: boolean): Promise<string> {
    if (!isValidId(id)) throw new Error('invalid note id');
    const base = await resolveContainedDir(dir(dataDir), dataDir, create);
    return path.join(base, `${id}.md`);
  }

  async function containedIndexPath(dataDir: string, create: boolean): Promise<string> {
    const base = await resolveContainedDir(dir(dataDir), dataDir, create);
    return path.join(base, INDEX_FILE);
  }

  async function containedConfigPath(dataDir: string, create: boolean): Promise<string> {
    const base = await resolveContainedDir(dir(dataDir), dataDir, create);
    return path.join(base, CONFIG_FILE);
  }

  async function readConfig(dataDir: string): Promise<NoteStoreOptions> {
    let raw: string;
    try {
      const filePath = await containedConfigPath(dataDir, false);
      raw = await readRegularFileStrict(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return { enabled: true };
      // Anything else — corrupt/unreadable file, permission denied, a
      // symlink rejected by readRegularFileStrict, or the directory itself
      // escaping its root — must not silently re-enable memory.
      throw new NoteStoreConfigError(
        `note store config could not be read; refusing to default to "enabled" (${(err as Error).message})`,
        code ?? 'EUNKNOWN',
        err,
      );
    }
    let parsed: { enabled?: unknown };
    try {
      parsed = JSON.parse(raw) as { enabled?: unknown };
    } catch (err) {
      throw new NoteStoreConfigError(
        'note store config is corrupt JSON; refusing to default to "enabled"',
        'EPARSE',
        err,
      );
    }
    return { enabled: parsed?.enabled !== false };
  }

  async function writeConfig(dataDir: string, patch: Partial<NoteStoreOptions>): Promise<NoteStoreOptions> {
    const current = await readConfig(dataDir);
    const next: NoteStoreOptions = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    };
    const filePath = await containedConfigPath(dataDir, true);
    await atomicWriteFile(filePath, JSON.stringify(next, null, 2));
    if (current.enabled !== next.enabled) emitChange({ kind: 'config', enabled: next.enabled });
    return next;
  }

  async function readIndex(dataDir: string): Promise<string> {
    try {
      const filePath = await containedIndexPath(dataDir, false);
      const found = await readRegularFileOrNull(filePath);
      return found ? found.raw : DEFAULT_INDEX;
    } catch {
      return DEFAULT_INDEX;
    }
  }

  async function writeIndex(dataDir: string, body: string, options?: { silent?: boolean }): Promise<void> {
    const filePath = await containedIndexPath(dataDir, true);
    await atomicWriteFile(filePath, body);
    if (!options?.silent) emitChange({ kind: 'index' });
  }

  function summarize(id: string, raw: string, mtime: number): { summary: NoteEntrySummary; body: string } {
    const { data, body } = parseEntryFrontmatter(raw);
    const type = isValidType(data.type) ? data.type : config.defaultType;
    return {
      summary: { id, name: data.name || id, description: data.description, type, updatedAt: mtime },
      body: body.trimStart(),
    };
  }

  async function listEntries(dataDir: string): Promise<NoteEntrySummary[]> {
    let base: string;
    let names: string[] = [];
    try {
      base = await resolveContainedDir(dir(dataDir), dataDir, false);
      names = await fsp.readdir(base);
    } catch {
      return [];
    }
    const out: NoteEntrySummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.md') || name === INDEX_FILE) continue;
      const id = name.slice(0, -3);
      if (!isValidId(id)) continue;
      const filePath = path.join(base, name);
      // Skip unreadable/malformed/non-regular (e.g. symlink) files rather
      // than let one shadow the rest or read through a planted symlink.
      const found = await readRegularFileOrNull(filePath);
      if (!found) continue;
      out.push(summarize(id, found.raw, found.mtimeMs).summary);
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  async function listActiveEntries(dataDir: string): Promise<NoteEntrySummary[]> {
    const [entries, indexBody] = await Promise.all([listEntries(dataDir), readIndex(dataDir)]);
    const linkedIds = parseIndexLinkIds(indexBody);
    return entries.filter((entry) => linkedIds.has(entry.id));
  }

  async function readEntry(dataDir: string, id: string): Promise<NoteEntry | null> {
    try {
      const filePath = await containedEntryPath(dataDir, id, false);
      const found = await readRegularFileOrNull(filePath);
      if (!found) return null;
      const { summary, body } = summarize(id, found.raw, found.mtimeMs);
      return { ...summary, body };
    } catch {
      return null;
    }
  }

  function parseIndexLinkIds(indexBody: string): Set<string> {
    const ids = new Set<string>();
    for (const line of indexBody.split(/\r?\n/)) {
      const m = INDEX_LINK_RE.exec(line);
      if (!m) continue;
      // Group 2 is `([^)]+)` (one-or-more, mandatory) — always populated on
      // a successful match; the assertion is TS-required, not reachable-undefined.
      const target = m[2]!;
      if (!target.endsWith('.md') || target === INDEX_FILE) continue;
      const id = target.slice(0, -3);
      if (isValidId(id)) ids.add(id);
    }
    return ids;
  }

  async function ensureIndexHasEntry(dataDir: string, id: string, name: string, description: string): Promise<void> {
    const current = await readIndex(dataDir);
    const lines = current.split(/\r?\n/);
    const link = `${id}.md`;
    const safeName = escapeIndexText(name) || id;
    const safeDesc = escapeIndexText(description);
    const newLine = safeDesc ? `- [${safeName}](${link}) — ${safeDesc}` : `- [${safeName}](${link})`;
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      // `i < lines.length` bounds the loop, so the index access is always
      // defined — the assertion is TS-required (noUncheckedIndexedAccess).
      const m = INDEX_LINK_RE.exec(lines[i]!);
      if (m && m[2] === link) {
        lines[i] = newLine;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      lines.push(newLine);
    }
    // Silent: the caller emits its own change event for the write as a whole.
    await writeIndex(dataDir, lines.join('\n'), { silent: true });
  }

  async function removeIndexLine(dataDir: string, id: string): Promise<void> {
    const current = await readIndex(dataDir);
    const link = `${id}.md`;
    const lines = current.split(/\r?\n/).filter((line) => {
      const m = INDEX_LINK_RE.exec(line);
      return !m || m[2] !== link;
    });
    await writeIndex(dataDir, lines.join('\n'), { silent: true });
  }

  async function upsertEntry(
    dataDir: string,
    input: { id?: string; name: string; description?: string; type: string; body?: string },
    options?: { silent?: boolean; source?: string },
  ): Promise<NoteEntry> {
    const { name, type, body } = input;
    const description = input.description ?? '';
    if (!name || !isValidType(type)) {
      throw new Error('note entry requires `name` and a valid `type`');
    }
    const id = input.id && isValidId(input.id) ? input.id : deriveId(type, name);
    const filePath = await containedEntryPath(dataDir, id, true);
    await atomicWriteFile(filePath, renderEntryFrontmatter({ name, description, type }, body ?? ''));
    await ensureIndexHasEntry(dataDir, id, name, description);
    const entry = await readEntry(dataDir, id);
    if (!entry) throw new Error('failed to read note entry after write');
    if (!options?.silent) {
      emitChange({
        kind: 'upsert',
        id: entry.id,
        name: entry.name,
        description: entry.description,
        type: entry.type,
        ...(options?.source !== undefined ? { source: options.source } : {}),
      });
    }
    return entry;
  }

  async function deleteEntry(dataDir: string, id: string): Promise<void> {
    try {
      // `unlink` removes the directory entry itself and never dereferences
      // a symlink to delete its target, so this is safe even if the path
      // turns out to be a planted symlink; a missing/invalid/escaping path
      // is treated the same as "already gone" — the caller doesn't need to
      // distinguish those for a best-effort delete of the primary file.
      const filePath = await containedEntryPath(dataDir, id, false);
      await fsp.unlink(filePath);
    } catch {
      // Already gone — fine, caller doesn't care.
    }
    await removeIndexLine(dataDir, id);
    emitChange({ kind: 'delete', id });
  }

  async function updateTreeNode(
    dataDir: string,
    id: string,
    patch: { name?: string; description?: string; type?: string; body?: string },
  ): Promise<NoteEntry> {
    if (id.startsWith('folder:')) throw new Error('note tree folders are derived and cannot be edited');
    const current = await readEntry(dataDir, id);
    if (!current) throw new Error('note not found');
    const nextType = isValidType(patch.type) ? patch.type : current.type;
    return upsertEntry(dataDir, {
      id,
      name: patch.name?.trim() ? patch.name : current.name,
      description: patch.description ?? current.description,
      type: nextType,
      body: patch.body ?? current.body,
    });
  }

  function folderId(type: string): string {
    return `folder:${type}`;
  }

  function toIsoTime(ms: number): string {
    return new Date(ms).toISOString();
  }

  async function buildTree(dataDir: string): Promise<NoteTreeNode[]> {
    const entries = await listEntries(dataDir);
    const byType = new Map<string, NoteEntrySummary[]>();
    for (const type of config.validTypes) byType.set(type, []);
    for (const entry of entries) {
      const list = byType.get(entry.type) ?? [];
      list.push(entry);
      byType.set(entry.type, list);
    }

    const nodes: NoteTreeNode[] = [];
    for (const type of config.validTypes) {
      // `byType` was seeded with every `config.validTypes` member just
      // above, so a key drawn from that same list is always present here
      // (an entry whose type falls outside `validTypes` — see line above —
      // adds an extra key, but this loop never visits that extra key).
      const children = byType.get(type)!;
      const folderUpdatedAt = children.reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0);
      const id = folderId(type);
      nodes.push({
        id,
        parentId: null,
        path: `/${type}`,
        name: capitalize(type),
        description: `${capitalize(type)} notes`,
        kind: 'folder',
        type,
        createdAt: toIsoTime(folderUpdatedAt),
        updatedAt: toIsoTime(folderUpdatedAt),
        childrenCount: children.length,
      });
      for (const entry of children) {
        nodes.push({
          id: entry.id,
          parentId: id,
          path: `/${type}/${entry.id}`,
          name: entry.name,
          description: entry.description,
          kind: 'entry',
          type: entry.type,
          createdAt: toIsoTime(entry.updatedAt),
          updatedAt: toIsoTime(entry.updatedAt),
          childrenCount: 0,
        });
      }
    }
    return nodes;
  }

  return {
    events,
    dir,
    deriveId,
    readConfig,
    writeConfig,
    readIndex,
    writeIndex,
    listEntries,
    listActiveEntries,
    readEntry,
    upsertEntry,
    deleteEntry,
    updateTreeNode,
    buildTree,
  };
}

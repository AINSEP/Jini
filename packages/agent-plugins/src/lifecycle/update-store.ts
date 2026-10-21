import path from 'node:path';
import { writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { createPersistentStateModule } from './persistent-state.js';
import type { AgentPluginLifecyclePorts } from './ports.js';

/** One update transaction's durable intent and, once finished, its audit record (`result`).
 * `settingsSnapshot` is the host's NON-SECRET settings summary; hosts must never put secret values
 * in it, because it is retained in the update history after the transaction ends. */
export interface AgentPluginUpdateJournal {
  readonly schemaVersion: 1;
  readonly state: 'pending' | 'published' | 'committed';
  readonly transactionId: string;
  readonly pluginId: string;
  readonly actor: string;
  readonly enabled: boolean;
  readonly fromDigest: string;
  readonly toDigest: string;
  readonly fromVersion?: string | undefined;
  readonly toVersion?: string | undefined;
  readonly settingsSnapshot: unknown;
  readonly startedAt: string;
  readonly result?: 'updated' | 'rolled-back';
}

export class AgentPluginUpdateError extends Error {
  readonly code: string;
  constructor(required: { code: string; message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional); this.code = required.code; this.name = 'AgentPluginUpdateError';
  }
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const TRANSACTION_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;
const JOURNAL_STATES: readonly unknown[] = ['pending', 'published', 'committed'];

function invalidJournal(optional: ErrorOptions = {}): AgentPluginUpdateError {
  return new AgentPluginUpdateError({ code: 'UPDATE_JOURNAL_INVALID', message: 'Update recovery record is invalid.' }, optional);
}

function hasValidIdentity({ raw, pluginId }: { raw: Record<string, unknown>; pluginId: string }): boolean {
  return raw.schemaVersion === 1 && raw.pluginId === pluginId && typeof raw.actor === 'string' && typeof raw.enabled === 'boolean';
}

/** Digests become path segments in recovery; the grammar check is what keeps them segments. */
function hasValidDigests({ raw }: { raw: Record<string, unknown> }): boolean {
  const digests = [raw.fromDigest, raw.toDigest];
  return raw.fromDigest !== raw.toDigest && digests.every(digest => typeof digest === 'string' && DIGEST_PATTERN.test(digest));
}

/** The transaction id names the history file, so it gets the same segment discipline. */
function hasValidTransaction({ raw }: { raw: Record<string, unknown> }): boolean {
  return JOURNAL_STATES.includes(raw.state) && typeof raw.transactionId === 'string'
    && TRANSACTION_PATTERN.test(raw.transactionId) && typeof raw.startedAt === 'string';
}

/** Validates durable intent before using it; no journal field is ever accepted as a path.
 * A damaged journal blocks mutations instead of discarding the only recovery record.
 */
function parseJournal({ value, pluginId }: { value: unknown; pluginId: string }, _optional = {}): AgentPluginUpdateJournal {
  if (typeof value !== 'object' || value === null) throw invalidJournal();
  const raw = value as Record<string, unknown>;
  if (!hasValidIdentity({ raw, pluginId }) || !hasValidDigests({ raw }) || !hasValidTransaction({ raw })) throw invalidJournal();
  return raw as unknown as AgentPluginUpdateJournal;
}

/** Durable per-plugin journal, audit history and frozen rollback area, all under the plugin's own
 * state root (never under `package/sha256`, so a rollback copy is never a live digest). Files use
 * the existing platform atomic writer. Settings snapshots are private (0600) and never returned to
 * tools or HTTP callers.
 * @complexity O(s) serialization of the host's settings slice.
 */
export function createAgentPluginUpdateStore({ ports, workspaceId, pluginId }: {
  ports: AgentPluginLifecyclePorts; workspaceId: string; pluginId: string;
}, _optional: Record<string, never> = {}) {
  const workspace = ports.layout.forWorkspace({ workspaceId });
  const root = workspace.pluginRootDir({ pluginId });
  const journalPath = path.join(root, 'update-journal.json');
  const rollbackDir = path.join(root, 'rollback');
  const persistent = createPersistentStateModule(ports);
  async function contain({ entryPath }: { entryPath: string }, _optional = {}): Promise<void> {
    await persistent.assertOwnedPath({ workspaceRoot: workspace.root, entryPath: path.relative(workspace.root, entryPath) });
  }
  async function read(_required: Record<string, never>, _optional = {}): Promise<AgentPluginUpdateJournal | undefined> {
    await contain({ entryPath: journalPath });
    let text: string;
    try { text = await ports.filesystem.readFile(journalPath, 'utf8'); }
    catch (error) { if (!isMissing({ error })) throw error; return undefined; }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch (cause) { throw invalidJournal({ cause }); }
    return parseJournal({ value, pluginId });
  }
  async function write({ journal, history = false }: { journal: AgentPluginUpdateJournal; history?: boolean }, _optional = {}): Promise<void> {
    const filePath = history ? path.join(root, 'update-history', `${journal.transactionId}.json`) : journalPath;
    await contain({ entryPath: filePath });
    await writeJsonFileAtomicAsync({ filePath, data: journal }, { fs: ports.filesystem,
      createParent: true, mode: 0o600, platform: ports.process.platform, tempName: () => ports.ids.newId() });
  }
  async function clear(_required: Record<string, never>, _optional = {}): Promise<void> {
    await contain({ entryPath: journalPath });
    await ports.filesystem.rm(journalPath, { force: true });
  }
  /** Audit first, then drop the active journal: a crash between the two leaves a finished journal
   * that the next update or boot re-files (same transaction id, so the history write is idempotent). */
  async function finish({ journal }: { journal: AgentPluginUpdateJournal }, _optional = {}): Promise<void> {
    await write({ journal, history: true });
    await clear({});
  }
  async function prepare(_required: Record<string, never>, _optional = {}): Promise<void> {
    await contain({ entryPath: rollbackDir });
    await ports.filesystem.mkdir(rollbackDir, { recursive: true, mode: 0o700 });
  }
  /** Retained rollback copies (digest-named directories only); other entries are never touched. */
  async function listRollbackRoots(_required: Record<string, never>, _optional = {}): Promise<string[]> {
    await contain({ entryPath: rollbackDir });
    let entries;
    try { entries = await ports.filesystem.readdir(rollbackDir, { withFileTypes: true }); }
    catch (error) { if (!isMissing({ error })) throw error; return []; }
    return entries.filter(entry => entry.isDirectory() && DIGEST_PATTERN.test(entry.name)).map(entry => path.join(rollbackDir, entry.name));
  }
  return { read, write, clear, finish, prepare, listRollbackRoots, rollbackDir,
    rollbackRoot: ({ digest }: { digest: string }, _optional = {}) => path.join(rollbackDir, digest),
    liveRoot: ({ digest }: { digest: string }, _optional = {}) => path.join(workspace.pluginPackagesDir({ pluginId }), digest) };
}

export function isMissing({ error }: { error: unknown }, _optional = {}): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

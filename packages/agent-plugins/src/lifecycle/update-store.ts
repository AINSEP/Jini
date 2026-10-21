import path from 'node:path';
import { writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { createPersistentStateModule } from './persistent-state.js';
import type { AgentPluginLifecyclePorts } from './ports.js';

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

/** Validates durable intent before using it; no journal field is ever accepted as a path.
 * A damaged journal blocks mutations instead of discarding the only recovery record.
 */
function parseJournal({ value, pluginId }: { value: unknown; pluginId: string }, _optional = {}): AgentPluginUpdateJournal {
  if (typeof value !== 'object' || value === null) throw new AgentPluginUpdateError({ code: 'UPDATE_JOURNAL_INVALID', message: 'Update recovery record is invalid.' });
  const raw = value as Record<string, unknown>;
  const validIdentity = raw.schemaVersion === 1 && raw.pluginId === pluginId && typeof raw.actor === 'string' && typeof raw.enabled === 'boolean';
  const validDigests = raw.fromDigest !== raw.toDigest && [raw.fromDigest, raw.toDigest].every(digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest));
  const validState = ['pending', 'published', 'committed'].includes(String(raw.state));
  const validTransaction = typeof raw.transactionId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(raw.transactionId);
  if (!validIdentity || !validDigests || !validState || !validTransaction || typeof raw.startedAt !== 'string') {
    throw new AgentPluginUpdateError({ code: 'UPDATE_JOURNAL_INVALID', message: 'Update recovery record is invalid.' });
  }
  return raw as unknown as AgentPluginUpdateJournal;
}

/** Durable per-plugin journal and audit files, using the existing platform atomic writer.
 * Settings snapshots are private (0600) and never returned to tools or HTTP callers.
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
    catch (error) { if (isMissing({ error })) return undefined; throw error; }
    try { return parseJournal({ value: JSON.parse(text), pluginId }); }
    catch (cause) { throw new AgentPluginUpdateError({ code: 'UPDATE_JOURNAL_INVALID', message: 'Update recovery record could not be read.' }, { cause }); }
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
  async function prepare(_required: Record<string, never>, _optional = {}): Promise<void> {
    await contain({ entryPath: rollbackDir });
    await ports.filesystem.mkdir(rollbackDir, { recursive: true, mode: 0o700 });
  }
  return { read, write, clear, prepare,
    rollbackRoot: ({ digest }: { digest: string }, _optional = {}) => path.join(rollbackDir, digest),
    liveRoot: ({ digest }: { digest: string }, _optional = {}) => path.join(workspace.pluginPackagesDir({ pluginId }), digest) };
}

export function isMissing({ error }: { error: unknown }, _optional = {}): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

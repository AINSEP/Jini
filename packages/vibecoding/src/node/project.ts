import { createEditHistory, type EditHistory, type HistoryEntry } from '../core/history.js';
import { FsFilePathError } from '@jini-ai/core/filesystem';
import type { ProjectFilesystemPort } from '../core/project-filesystem.js';
import type { EditTarget } from '../core/target.js';
import type { ProposedEdit } from '../core/apply.js';
import type { ApplyOutcome, Snapshot } from '../core/types.js';
import { ProjectError, type FileChange, type FileTreeProject, type ProjectCandidate, type ProjectDiagnostic,
  type ProjectLimits, type ProjectValidator, type RevisionToken, type TurnResult } from '../core/project.js';
import { assertCandidatePaths, createProjectPaths, projectLimits, type FileTreePolicy, type ProjectPaths } from './paths.js';
import { createProjectStore, prepareDirectories, revisionToken, type Current, type ProjectStore } from './store.js';

export interface OpenFileTreeProjectInput {
  /** Native effects are supplied by the host composition root. */
  readonly filesystem: ProjectFilesystemPort;
  readonly root: string;
  /** Private host-owned directory outside the watched and served application tree. */
  readonly stateDir: string;
  readonly policy: FileTreePolicy;
  readonly validator?: ProjectValidator;
}
export interface OpenFileTreeProjectOptions {
  readonly limits?: Partial<ProjectLimits>;
  readonly historyLimit?: number;
}
const POINTER = 'revision';

function fail(code: ConstructorParameters<typeof ProjectError>[0]['code'], message: string): never {
  throw new ProjectError({ code, message });
}
function sameRevision(left: RevisionToken, right: RevisionToken): boolean {
  return left.generation === right.generation && left.revisionId === right.revisionId;
}
/** Materialize a single immutable candidate in memory before invoking a whole-project validator.
 * @complexity O(tree bytes + changes + path segments) time/space, all bounded by project limits.
 */
function changeFiles({ files: base, changes, paths, limits }: {
  files: ReadonlyMap<string, Uint8Array>; changes: readonly FileChange[]; paths: ProjectPaths; limits: ProjectLimits;
}): Map<string, Uint8Array> {
  if (changes.length > limits.maxChanges) fail('LIMIT', 'too many changes in one turn');
  const files = new Map(base), seen = new Set<string>();
  for (const change of changes) {
    const path = paths.check({ relativePath: change.op === 'create' ? change.relativePath : change.id });
    if (seen.has(path)) fail('INVALID_CHANGE', `multiple operations for ${path}`);
    seen.add(path);
    changeFile({ files, change, path, limits });
  }
  assertCandidatePaths({ paths: [...files.keys()] });
  assertTreeLimits({ files, limits });
  return files;
}
function changeFile({ files, change, path, limits }: {
  files: Map<string, Uint8Array>; change: FileChange; path: string; limits: ProjectLimits;
}): void {
  if (change.op === 'create' && files.has(path)) fail('INVALID_CHANGE', `file already exists: ${path}`);
  if (change.op !== 'create' && !files.has(path)) fail('INVALID_CHANGE', `file not listed: ${path}`);
  if (change.op === 'delete') { files.delete(path); return; }
  if (change.content.length > limits.maxFileBytes) fail('LIMIT', `file exceeds byte limit: ${path}`);
  const bytes = new TextEncoder().encode(change.content);
  if (bytes.byteLength > limits.maxFileBytes) fail('LIMIT', `file exceeds byte limit: ${path}`);
  files.set(path, bytes);
}
function assertTreeLimits({ files, limits }: { files: ReadonlyMap<string, Uint8Array>; limits: ProjectLimits }): void {
  if (files.size > limits.maxFiles) fail('LIMIT', 'candidate exceeds file count');
  let total = 0;
  for (const bytes of files.values()) total += bytes.byteLength;
  if (total > limits.maxTreeBytes) fail('LIMIT', 'candidate exceeds tree byte limit');
}
function candidateView({ files }: { files: ReadonlyMap<string, Uint8Array> }): ProjectCandidate {
  return Object.freeze({
    paths: Object.freeze([...files.keys()].sort()),
    async readBytes({ relativePath }: { relativePath: string }, _options = {}) {
      const bytes = files.get(relativePath);
      if (!bytes) fail('INVALID_PATH', `file not in candidate: ${relativePath}`);
      return Uint8Array.from(bytes);
    },
  });
}
/** Bound host diagnostics before retaining or sending them back to a model. */
function diagnosticsFor(input: readonly ProjectDiagnostic[] = []): readonly ProjectDiagnostic[] {
  return input.slice(0, 100).map(item => ({ code: item.code.slice(0, 100), message: item.message.slice(0, 2000),
    ...(item.relativePath === undefined ? {} : { relativePath: item.relativePath.slice(0, 200) }) }));
}
/** Timeout/cancellation races the validator, even when an adapter ignores its AbortSignal.
 * @complexity O(candidate bytes) only in the adapter; this wrapper uses O(1) resources.
 */
async function validateCandidate({ validator, candidate, signal, timeoutMs }: {
  validator: ProjectValidator | undefined; candidate: ProjectCandidate; signal: AbortSignal | undefined; timeoutMs: number;
}): Promise<readonly ProjectDiagnostic[]> {
  if (signal?.aborted) fail('CANCELLED', 'turn cancelled');
  if (!validator) return [];
  const controller = new AbortController();
  const cancel = () => controller.abort(new ProjectError({ code: 'CANCELLED', message: 'turn cancelled' }));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new ProjectError({ code: 'VALIDATION', message: 'validation timed out' })), timeoutMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([validator.validate({ candidate, signal: controller.signal }), aborted]);
    if (result.ok) return [];
    const diagnostics = diagnosticsFor(result.diagnostics);
    return diagnostics.length ? diagnostics : [{ code: 'VALIDATION', message: 'candidate refused by validator' }];
  } catch (cause) {
    if (cause instanceof ProjectError) throw cause;
    throw new ProjectError({ code: 'VALIDATION', message: 'project validator failed', cause });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Open real local files with process-crash roll-forward and session-local pointer history.
 * @throws ProjectError for conflicts, unsafe paths, corruption, limits or I/O failure.
 * @complexity O(files + bytes) opening/capture; each turn is bounded by configured tree limits.
 */
export async function openFileTreeProject(input: OpenFileTreeProjectInput, options: OpenFileTreeProjectOptions = {}): Promise<FileTreeProject> {
  const limits = projectLimits(options);
  const historyLimit = options.historyLimit ?? 50;
  if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) throw new TypeError('historyLimit must be positive');
  try {
    const directories = await prepareDirectories(input);
    const paths = createProjectPaths({ root: directories.root, policy: input.policy, limits, filesystem: input.filesystem });
    const store = createProjectStore({ ...directories, paths, limits, filesystem: input.filesystem });
    const project = assembleProject({ store, paths, limits, historyLimit, validator: input.validator });
    await project.capture();
    return project;
  } catch (cause) {
    if (cause instanceof ProjectError || cause instanceof TypeError) throw cause;
    throw new ProjectError({ code: 'STORAGE', message: 'could not open local project', cause });
  }
}

type ProjectState = {
  current: Current | null; closed: boolean; selectingCapture: Current['observed'] | undefined; queue: Promise<unknown>;
};
type ProjectContext = Parameters<typeof assembleProject>[0] & { state: ProjectState; rawHistory: EditHistory };

/** One process-local queue plus the shared file lock covers all mutation paths.
 * Validation releases the shared lock, then checks generation AND working-tree drift again.
 */
function assembleProject({ store, paths, limits, historyLimit, validator }: {
  store: ProjectStore; paths: ProjectPaths; limits: ProjectLimits; historyLimit: number; validator: ProjectValidator | undefined;
}): FileTreeProject {
  const state: ProjectState = { current: null, closed: false, selectingCapture: undefined, queue: Promise.resolve() };
  const pointer = createRevisionPointer(state, store);
  const rawHistory = createEditHistory({ target: pointer }, { limit: historyLimit });
  const context: ProjectContext = { store, paths, limits, historyLimit, validator, state, rawHistory };
  return createProjectAdapters(context);
}

function createRevisionPointer(state: ProjectState, store: ProjectStore): EditTarget {
  const context = { state };
  return {
    listParts: async () => [{ id: POINTER }],
    readPart: async () => selected(context).revision,
    replacePart: async ({ id, content }) => {
      if (id !== POINTER) fail('INVALID_CHANGE', 'private revision pointer only');
      if (!context.state.selectingCapture) await store.preflight({ current: context.state.current, revisionId: content });
      context.state.current = await store.select({ current: selected(context), revisionId: content, captured: context.state.selectingCapture });
    },
    validate: async () => ({ ok: true }),
    snapshot: async () => ({ id: selected(context).revision, parts: { [POINTER]: selected(context).revision } }),
    restore: async () => { fail('INVALID_CHANGE', 'use project.restore'); },
  };
}

function selected(context: Pick<ProjectContext, 'state'>): Current {
  if (!context.state.current) fail('CORRUPT', 'project has no current revision');
  return context.state.current;
}

function serial<T>(context: ProjectContext, work: () => Promise<T>): Promise<T> {
  const next = context.state.queue.then(async () => {
    if (context.state.closed) fail('CLOSED', 'project is closed');
    return work();
  });
  context.state.queue = next.catch(() => {});
  return next;
}

/** Never replay a local stack over a different writer's generation, even after A→B→A. */
async function synchronize(context: ProjectContext): Promise<void> {
  const { store, rawHistory } = context;
  const disk = await store.recover();
  if (context.state.current && (!disk || !sameRevision(revisionToken({ current: context.state.current }), revisionToken({ current: disk })))) {
    context.state.current = disk;
    rawHistory.clear();
    fail('CONFLICT', 'project generation changed; local history cleared');
  }
  context.state.current = disk;
}

async function locked<T>(context: ProjectContext, work: () => Promise<T>): Promise<T> {
  const { store } = context;
  try { return await store.locked(async () => { await synchronize(context); return work(); }); }
  catch (cause) {
    // Only synchronize() clears history: another writer's generation makes the stacks unsound.
    // A stale caller token or a file written mid-scan leaves this handle's stacks coherent.
    if (cause instanceof ProjectError) throw cause;
    if (cause instanceof FsFilePathError) throw new ProjectError({ code: 'INVALID_PATH', message: cause.message, cause });
    throw new ProjectError({ code: 'STORAGE', message: 'project storage operation failed', cause });
  }
}

/** The pointer write is the only and last write inside history's recording callback. */
async function record(context: ProjectContext, { revisionId, captured, label }: { revisionId: string; captured?: Current['observed']; label?: string }): Promise<void> {
  const { store, rawHistory } = context;
  if (!captured) await store.preflight({ current: context.state.current, revisionId });
  context.state.selectingCapture = captured;
  try {
    await rawHistory.transaction({ work: recording => recording.replacePart({ id: POINTER, content: revisionId }) },
      label === undefined ? {} : { label });
  } finally { context.state.selectingCapture = undefined; }
}

async function collect(context: ProjectContext): Promise<void> {
  const { store, rawHistory } = context;
  const revisions = new Set([selected(context).revision]);
  for (const entry of rawHistory.retainedEntries()) {
    for (const change of entry.changes) { revisions.add(change.before); revisions.add(change.after); }
  }
  await store.collect({ revisions });
}

/** Drift becomes a normal revision without overwriting what npm/editor/user just wrote. */
async function captureLocked(context: ProjectContext): Promise<Map<string, Uint8Array>> {
  const { store } = context;
  const { files, observed } = await store.scan({ current: context.state.current });
  const revisionId = await store.prepare({ files });
  const previous = context.state.current?.revision;
  if (!context.state.current) context.state.current = await store.select({ current: null, revisionId, captured: observed });
  else if (context.state.current.revision !== revisionId) await record(context, { revisionId, captured: observed, label: 'Capture external changes' });
  else context.state.current = await store.observe({ current: context.state.current, observed });
  if (previous !== revisionId) await collect(context);
  return files;
}

/** The caller's view is stale (e.g. drift captured as its own entry); history stays intact. */
function checkExpected(context: ProjectContext, expected: RevisionToken): void {
  if (sameRevision(expected, revisionToken({ current: selected(context) }))) return;
  fail('CONFLICT', 'expected revision is stale; capture/refresh and retry');
}

async function applyTurn(context: ProjectContext, input: { expectedRevision: RevisionToken; changes: readonly FileChange[] },
  options: { label?: string; signal?: AbortSignal } = {}): Promise<TurnResult> {
  const { paths, limits, validator } = context;
  return serial(context, async () => {
    const files = await locked(context, async () => {
      const base = await captureLocked(context);
      checkExpected(context, input.expectedRevision);
      return changeFiles({ files: base, changes: input.changes, paths, limits });
    });
    const diagnostics = await validateCandidate({ validator, candidate: candidateView({ files }), signal: options.signal, timeoutMs: limits.validationTimeoutMs });
    return locked<TurnResult>(context, async () => {
      // Validation can run arbitrary host code; do not silently erase edits made while it ran.
      await captureLocked(context);
      checkExpected(context, input.expectedRevision);
      if (options.signal?.aborted) fail('CANCELLED', 'turn cancelled');
      if (diagnostics.length) return { status: 'rejected', revision: revisionToken({ current: selected(context) }), diagnostics };
      return commitFiles(context, { files, label: options.label });
    });
  });
}

async function commitFiles(context: ProjectContext, { files, label }: { files: ReadonlyMap<string, Uint8Array>; label: string | undefined }): Promise<TurnResult> {
  const { store } = context;
  const revisionId = await store.prepare({ files });
  if (revisionId === selected(context).revision) return { status: 'unchanged', revision: revisionToken({ current: selected(context) }), diagnostics: [] };
  await record(context, { revisionId, ...(label === undefined ? {} : { label }) });
  await collect(context);
  return { status: 'committed', revision: revisionToken({ current: selected(context) }), diagnostics: [] };
}

async function replay(context: ProjectContext, side: 'undo' | 'redo'): Promise<HistoryEntry | null> {
  const { rawHistory } = context;
  return serial(context, () => locked(context, async () => {
    await captureLocked(context);
    const entry = await rawHistory[side]();
    await collect(context);
    return entry;
  }));
}

async function restoreRevision(context: ProjectContext, { revisionId, label }: { revisionId: string; label?: string }): Promise<RevisionToken> {
  const { store } = context;
  return serial(context, () => locked(context, async () => {
    await captureLocked(context);
    await retainedManifest({ store, revisionId });
    if (selected(context).revision !== revisionId) await record(context, { revisionId, ...(label === undefined ? {} : { label }) });
    await collect(context);
    return revisionToken({ current: selected(context) });
  }));
}

async function textSnapshot(context: ProjectContext): Promise<Snapshot> {
  return serial(context, () => locked(context, async () => {
    const files = await captureLocked(context);
    const parts: Record<string, string> = Object.create(null);
    for (const [path, bytes] of files) parts[path] = decodeText({ bytes });
    return { id: selected(context).revision, parts };
  }));
}

async function restoreText(context: ProjectContext, { snapshot }: { snapshot: Snapshot }): Promise<HistoryEntry | null> {
  const { rawHistory } = context;
  // Snapshot IDs name retained manifests. Replaying them preserves binary files and deletions.
  const before = rawHistory.entries().at(-1);
  await restoreRevision(context, { revisionId: snapshot.id, label: `restore ${snapshot.id}` });
  const after = rawHistory.entries().at(-1);
  return before === after ? null : after ?? null;
}

function createProjectHistory(context: ProjectContext): EditHistory {
  const { rawHistory } = context;
  return {
    transaction: async () => fail('INVALID_CHANGE', 'use project.applyTurn for atomic transactions'),
    canUndo: rawHistory.canUndo, canRedo: rawHistory.canRedo,
    undo: () => replay(context, 'undo'), redo: () => replay(context, 'redo'), restore: input => restoreText(context, input),
    entries: rawHistory.entries, retainedEntries: rawHistory.retainedEntries, clear: rawHistory.clear,
  };
}

async function listPartsLocked(context: ProjectContext) { return [...(await captureLocked(context)).keys()].sort().map(id => ({ id })); }
async function readPartLocked(context: ProjectContext, id: string) {
  const { paths, store } = context;
  paths.check({ relativePath: id });
  const manifest = await store.manifest({ revisionId: selected(context).revision });
  if (!manifest.files.some(file => file.path === id)) fail('INVALID_CHANGE', `file not listed: ${id}`);
  return decodeText({ bytes: await store.readWorkingFile({ relativePath: id }) });
}

function createProjectTarget(context: ProjectContext, applyEdits: FileTreeProject['applyEdits']): EditTarget {
  return {
    listParts: () => serial(context, () => locked(context, () => listPartsLocked(context))),
    readPart: ({ id }) => serial(context, () => locked(context, () => readPartLocked(context, id))),
    replacePart: async edit => {
      const outcomes = await applyEdits({ edits: [edit] });
      const outcome = outcomes[0]!;
      if (outcome.status === 'failed') throw outcome.error;
      if (outcome.status === 'rejected') fail('VALIDATION', outcome.reason);
    },
    validate: async () => ({ ok: true }), // replacePart owns whole-candidate validation, including direct calls.
    snapshot: () => textSnapshot(context), restore: async input => { await restoreText(context, input); },
  };
}

function createProjectAdapters(context: ProjectContext): FileTreeProject {
  async function applyEdits({ edits }: { edits: readonly ProposedEdit[] }, options: { label?: string } = {}): Promise<readonly ApplyOutcome[]> {
    const expectedRevision = await project.capture();
    const changes: FileChange[] = edits.map(edit => ({ op: 'replace', ...edit }));
    try {
      const result = await applyTurn(context, { expectedRevision, changes }, options);
      if (result.status !== 'rejected') return edits.map(({ id }) => ({ status: 'applied', id }));
      const reason = result.diagnostics.map(diagnostic => diagnostic.message).join('\n');
      return edits.map(({ id }) => ({ status: 'rejected', id, reason }));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      return edits.map(({ id }) => ({ status: 'failed', id, error: failure }));
    }
  }
  const history = createProjectHistory(context);
  const target = createProjectTarget(context, applyEdits);
  const { rawHistory } = context;
  const project: FileTreeProject = {
    target, history, applyTurn: (input, options = {}) => applyTurn(context, input, options), applyEdits,
    getRevision: () => serial(context, () => locked(context, async () => revisionToken({ current: selected(context) }))),
    capture: () => serial(context, () => locked(context, async () => { await captureLocked(context); await collect(context); return revisionToken({ current: selected(context) }); })),
    snapshot: () => serial(context, () => locked(context, async () => { await captureLocked(context); return { revisionId: selected(context).revision }; })),
    restore: ({ snapshot }, options = {}) => restoreRevision(context, { revisionId: snapshot.revisionId, ...options }),
    close: () => serial(context, () => locked(context, async () => { rawHistory.clear(); await collect(context); context.state.closed = true; })),
  };
  return project;
}
/** Keep a leading BOM in the text so a read-modify-replace round trip preserves the file's bytes. */
function decodeText({ bytes }: { bytes: Uint8Array }): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (cause) { throw new ProjectError({ code: 'INVALID_CHANGE', message: 'binary asset cannot be read as UTF-8 text; use a candidate byte read', cause }); }
}
async function retainedManifest({ store, revisionId }: { store: ProjectStore; revisionId: string }): Promise<void> {
  try { await store.manifest({ revisionId }); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') fail('SNAPSHOT_EXPIRED', 'snapshot revision is no longer retained');
    throw cause;
  }
}

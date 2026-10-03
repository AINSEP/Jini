/**
 * @module terminal
 *
 * In-memory interactive terminal (PTY) session manager. Each session keeps
 * a bounded event ring-buffer so a reattaching client can replay recent
 * scrollback after a last-seen event id, then fans out live output to every
 * attached sink. Sessions are process-local and never persisted — shutting
 * the host down kills every PTY (see {@link TerminalService.shutdownActive}).
 *
 * Generalized from OD's `apps/daemon/src/terminals.ts`: the origin imported
 * `node-pty` directly and coupled `stream()` to an Express `req`/`res` pair.
 * Both couplings are real ports here instead — {@link PtySpawn} (the caller
 * supplies node-pty, or any PTY backend, or a fake for tests) and
 * {@link TerminalSseSink} (a minimal push/end sink; no Express/HTTP types
 * enter this package). This keeps the module transport- and PTY-backend-
 * agnostic, which matters beyond OD: Zana and Open-Marketing both
 * independently need a terminal/PTY port, so this shape is designed to be
 * the shared foundation rather than scoped narrowly to one daemon's routes.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** A single running PTY child process, however the caller's backend spawns it. */
export interface PtyProcess {
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

/** Spawns a PTY. The caller supplies this — e.g. a thin wrapper around `node-pty`'s `spawn`. */
export type PtySpawn = (shell: string, args: string[], options: PtySpawnOptions) => PtyProcess;

/**
 * Resolves the candidate paths to node-pty's `spawn-helper` binary. On
 * macOS/Linux, `pty.fork` shells out to this helper via `posix_spawn`;
 * node-pty looks for the native artifacts under `build/Release` first and a
 * platform-tagged `prebuilds/<platform>-<arch>` dir second. Returns both so
 * {@link ensureSpawnHelperExecutable} covers whichever one a given install
 * produced. Empty on win32 (ConPTY has no helper) or when node-pty can't be
 * resolved at all (not installed, or a workspace that doesn't use it).
 *
 * @param options.platform - Defaults to `process.platform`; injectable for tests.
 * @param options.resolve - Defaults to a `require.resolve`-shaped resolver for
 *   `'node-pty'`; injectable so this stays testable without the native module.
 */
export function spawnHelperCandidatePaths(options: {
  platform?: NodeJS.Platform;
  resolve?: (specifier: string) => string;
} = {}): string[] {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return [];
  const resolve = options.resolve ?? resolveNodePtyEntryPoint;
  let pkgRoot: string;
  try {
    // node-pty's "main" is `lib/index.js`, so the package root is two levels
    // up from the resolved entry.
    pkgRoot = path.dirname(path.dirname(resolve('node-pty')));
  } catch {
    return [];
  }
  return [
    path.join(pkgRoot, 'build', 'Release', 'spawn-helper'),
    path.join(pkgRoot, 'prebuilds', `${platform}-${process.arch}`, 'spawn-helper'),
  ];
}

function resolveNodePtyEntryPoint(specifier: string): string {
  // A runtime `require.resolve` call (not a static `import`) avoids a
  // module specifier TypeScript would try to resolve at compile time —
  // node-pty is an optional peer a consumer brings, not a dependency of
  // this package.
  return require.resolve(specifier);
}

/**
 * Restores the executable bit on node-pty's `spawn-helper`. pnpm unpacks
 * node-pty's prebuilt binaries with mode 0644 — and node-pty's own
 * post-install hook only chmods `build/Release`, which a prebuild-based
 * install never creates. Re-adding +x before the first fork makes the
 * terminal self-heal across reinstalls without depending on an install hook.
 * Best-effort and idempotent: a missing file or a read-only filesystem is
 * swallowed, and the subsequent spawn surfaces the real error instead.
 *
 * @param candidatePaths - Defaults to {@link spawnHelperCandidatePaths}'s result.
 */
export function ensureSpawnHelperExecutable(candidatePaths: string[] = spawnHelperCandidatePaths()): void {
  for (const file of candidatePaths) {
    try {
      const stat = fs.statSync(file);
      if (stat.mode & 0o100) continue;
      fs.chmodSync(file, stat.mode | 0o111);
    } catch {
      // Candidate not present on this install, or fs is read-only: ignore and
      // let the spawn attempt report the underlying failure.
    }
  }
}

/**
 * Resolves the shell binary for a new PTY. Honors an explicit request
 * override, then the user's environment (`SHELL` on posix, `ComSpec` on
 * win32), and finally a per-platform default.
 */
export function resolveShell(
  requested?: string | null,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): string {
  const explicit = typeof requested === 'string' && requested.trim() ? requested.trim() : null;
  if (explicit) return explicit;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === 'win32') {
    return env.ComSpec || 'powershell.exe';
  }
  return env.SHELL || '/bin/bash';
}

function clampDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 1000);
}

const TERMINAL_STATUSES = new Set(['exited']);
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type TerminalEventData = { data: string } | { code: number | null; signal: string | null };

export interface TerminalEventRecord {
  id: number;
  event: 'data' | 'exit';
  data: TerminalEventData;
  timestamp: number;
  byteLength: number;
}

/** A minimal push sink a transport adapts its live connection to (e.g. SSE). */
export interface TerminalSseSink {
  send(event: string, data: TerminalEventData, id: number): void;
  end(): void;
}

export interface TerminalSession {
  readonly id: string;
  readonly projectId: string | null;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly status: 'running' | 'exited';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

interface InternalSession {
  id: string;
  projectId: string | null;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: string | null;
  events: TerminalEventRecord[];
  nextEventId: number;
  clients: Set<TerminalSseSink>;
  pty: PtyProcess;
  bufferedBytes: number;
  pendingData: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

function toPublicSession(session: InternalSession): TerminalSession {
  return {
    id: session.id,
    projectId: session.projectId,
    cwd: session.cwd,
    shell: session.shell,
    cols: session.cols,
    rows: session.rows,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exitCode: session.exitCode,
    signal: session.signal,
  };
}

export interface CreateTerminalOptions {
  projectId?: string | null;
  cwd: string;
  cols?: number;
  rows?: number;
  shell?: string | null;
}

export interface CreateTerminalServiceOptions {
  /** Lazily loads the PTY spawner. Concurrent `create()` calls share one attempt; success is cached, failure permits retry. */
  loadSpawnPty: () => Promise<PtySpawn>;
  /** Count backstop for the per-session output ring-buffer; `maxBufferBytes` is the real ceiling. */
  maxEvents?: number;
  /** UTF-8 byte ceiling for retained reattach scrollback (evicted oldest-first; the newest event is always kept). */
  maxBufferBytes?: number;
  /** Trailing scrollback kept once a shell exits, so an unreaped session doesn't pin memory. */
  exitTailBytes?: number;
  /** Coalesces PTY output for roughly one animation frame before fanning out one `data` event. */
  flushIntervalMs?: number;
  /** Flushes immediately once buffered output crosses this size, bypassing the frame timer. */
  flushThresholdBytes?: number;
  /** Drops an exited session from the registry after this idle window. */
  ttlMs?: number;
  /** Grace window given to children to exit during {@link TerminalService.shutdownActive}. */
  shutdownGraceMs?: number;
}

export interface TerminalService {
  create(options: CreateTerminalOptions): Promise<TerminalSession>;
  get(id: string): TerminalSession | null;
  list(filter?: { projectId?: string | null }): TerminalSession[];
  write(id: string, input: string): boolean;
  resize(id: string, cols: number, rows: number): boolean;
  kill(id: string, signal?: string): boolean;
  /** Replays scrollback after `lastEventId`, then attaches `sink` for live output if still running. */
  attach(id: string, lastEventId: number, sink: TerminalSseSink): 'attached' | 'ended' | 'not-found';
  detach(id: string, sink: TerminalSseSink): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
  isTerminal(status: string): boolean;
}

/**
 * Builds an in-memory terminal session manager. See the module docblock for
 * the design rationale; see {@link CreateTerminalServiceOptions} for tuning.
 */
export function createTerminalService(options: CreateTerminalServiceOptions): TerminalService {
  const {
    loadSpawnPty,
    maxEvents = 2_000,
    maxBufferBytes = 512 * 1024,
    exitTailBytes = 64 * 1024,
    flushIntervalMs = 16,
    flushThresholdBytes = 64 * 1024,
    ttlMs = 30 * 60 * 1000,
    shutdownGraceMs = 3_000,
  } = options;

  const sessions = new Map<string, InternalSession>();
  let cachedSpawnPty: Promise<PtySpawn> | null = null;

  const loadPty = (): Promise<PtySpawn> => {
    // Cache before invoking the loader so concurrent creates share the same
    // attempt, including a synchronous throw. Retain the existing retry-on-failure behavior.
    cachedSpawnPty ??= Promise.resolve().then(() => loadSpawnPty()).catch((error: unknown) => {
      cachedSpawnPty = null;
      throw error;
    });
    return cachedSpawnPty;
  };

  const scheduleCleanup = (session: InternalSession) => {
    setTimeout(() => {
      if (TERMINAL_STATUSES.has(session.status)) sessions.delete(session.id);
    }, ttlMs).unref?.();
  };

  const recordByteLength = (data: TerminalEventData): number => ('data' in data ? Buffer.byteLength(data.data, 'utf8') : 0);

  const trimBuffer = (session: InternalSession) => {
    if (session.bufferedBytes <= maxBufferBytes && session.events.length <= maxEvents) return;
    const targetBytes = Math.floor(maxBufferBytes * 0.75);
    let dropCount = 0;
    let freed = 0;
    for (let i = 0; i < session.events.length - 1; i++) {
      const overBytes = session.bufferedBytes - freed > targetBytes;
      const overCount = session.events.length - dropCount > maxEvents;
      if (!overBytes && !overCount) break;
      freed += session.events[i]!.byteLength;
      dropCount++;
    }
    if (dropCount > 0) {
      session.events.splice(0, dropCount);
      session.bufferedBytes -= freed;
    }
  };

  const emit = (session: InternalSession, event: 'data' | 'exit', data: TerminalEventData): TerminalEventRecord => {
    const id = session.nextEventId++;
    const byteLength = recordByteLength(data);
    const record: TerminalEventRecord = { id, event, data, timestamp: Date.now(), byteLength };
    session.events.push(record);
    session.bufferedBytes += byteLength;
    trimBuffer(session);
    session.updatedAt = record.timestamp;
    for (const sink of session.clients) sink.send(event, data, id);
    return record;
  };

  const flushData = (session: InternalSession) => {
    if (session.flushTimer != null) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (!session.pendingData) return;
    const chunk = session.pendingData;
    session.pendingData = '';
    emit(session, 'data', { data: chunk });
  };

  const finish = (session: InternalSession, code: number | null, signal: string | null) => {
    if (TERMINAL_STATUSES.has(session.status)) return;
    flushData(session);
    session.status = 'exited';
    session.exitCode = code;
    session.signal = signal;
    session.updatedAt = Date.now();
    emit(session, 'exit', { code, signal });
    // Bound the memory an exited-but-not-yet-reaped session pins: keep only
    // the trailing scrollback (the exit event is last, so it's always kept).
    let keptBytes = 0;
    let firstKeep = session.events.length;
    for (let i = session.events.length - 1; i >= 0; i--) {
      firstKeep = i;
      keptBytes += session.events[i]!.byteLength;
      if (keptBytes >= exitTailBytes) break;
    }
    if (firstKeep > 0) {
      const dropped = session.events.splice(0, firstKeep);
      for (const r of dropped) session.bufferedBytes -= r.byteLength;
    }
    for (const sink of session.clients) sink.end();
    session.clients.clear();
    scheduleCleanup(session);
  };

  const create = async (createOptions: CreateTerminalOptions): Promise<TerminalSession> => {
    const spawnPty = await loadPty();
    const now = Date.now();
    const id = randomUUID();
    const cols = clampDimension(createOptions.cols, DEFAULT_COLS);
    const rows = clampDimension(createOptions.rows, DEFAULT_ROWS);
    const shell = resolveShell(createOptions.shell);
    const pty = spawnPty(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd: createOptions.cwd,
      env: { ...process.env } as Record<string, string>,
    });
    const session: InternalSession = {
      id,
      projectId:
        typeof createOptions.projectId === 'string' && createOptions.projectId ? createOptions.projectId : null,
      cwd: createOptions.cwd,
      shell,
      cols,
      rows,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      signal: null,
      events: [],
      nextEventId: 1,
      clients: new Set(),
      pty,
      bufferedBytes: 0,
      pendingData: '',
      flushTimer: null,
    };
    sessions.set(id, session);
    pty.onData((chunk: string) => {
      session.pendingData += chunk;
      if (Buffer.byteLength(session.pendingData, 'utf8') >= flushThresholdBytes) {
        flushData(session);
        return;
      }
      if (session.flushTimer == null) {
        session.flushTimer = setTimeout(() => flushData(session), flushIntervalMs);
        session.flushTimer.unref?.();
      }
    });
    pty.onExit(({ exitCode, signal }) => {
      // `exitCode` is typed non-nullable on `PtyProcess.onExit` (matching
      // node-pty's own exit-event shape), so no `?? null` fallback is
      // reachable here — passed through directly rather than defensively
      // re-guarded against a case the type already rules out.
      finish(session, exitCode, signal ? signalName(signal) : null);
    });
    return toPublicSession(session);
  };

  const get = (id: string): TerminalSession | null => {
    const session = sessions.get(id);
    return session ? toPublicSession(session) : null;
  };

  const list = (filter: { projectId?: string | null } = {}): TerminalSession[] =>
    Array.from(sessions.values())
      .filter((session) => {
        if (typeof filter.projectId === 'string' && filter.projectId && session.projectId !== filter.projectId) {
          return false;
        }
        return true;
      })
      .map(toPublicSession);

  const attach = (id: string, lastEventId: number, sink: TerminalSseSink): 'attached' | 'ended' | 'not-found' => {
    const session = sessions.get(id);
    if (!session) return 'not-found';
    let sent = 0;
    for (const record of session.events) {
      if (!Number.isFinite(lastEventId) || record.id > lastEventId) {
        sink.send(record.event, record.data, record.id);
        sent++;
      }
    }
    if (TERMINAL_STATUSES.has(session.status)) {
      // Guarantee a reattaching client sees the terminal `exit` even if its
      // cursor is already past the final event id.
      if (sent === 0 && session.events.length > 0) {
        const last = session.events[session.events.length - 1]!;
        sink.send(last.event, last.data, last.id);
      }
      sink.end();
      return 'ended';
    }
    session.clients.add(sink);
    return 'attached';
  };

  const detach = (id: string, sink: TerminalSseSink): void => {
    sessions.get(id)?.clients.delete(sink);
  };

  const write = (id: string, input: string): boolean => {
    const session = sessions.get(id);
    if (!session || TERMINAL_STATUSES.has(session.status)) return false;
    try {
      session.pty.write(input);
      return true;
    } catch {
      return false;
    }
  };

  const resize = (id: string, cols: number, rows: number): boolean => {
    const session = sessions.get(id);
    if (!session || TERMINAL_STATUSES.has(session.status)) return false;
    const nextCols = clampDimension(cols, session.cols);
    const nextRows = clampDimension(rows, session.rows);
    try {
      session.pty.resize(nextCols, nextRows);
      session.cols = nextCols;
      session.rows = nextRows;
      session.updatedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  };

  const kill = (id: string, signal = 'SIGTERM'): boolean => {
    const session = sessions.get(id);
    if (!session || TERMINAL_STATUSES.has(session.status)) return false;
    try {
      session.pty.kill(signal);
      return true;
    } catch {
      // If the kill throws, force the terminal state so clients unblock.
      finish(session, null, signal);
      return false;
    }
  };

  const shutdownActive = async ({ graceMs = shutdownGraceMs }: { graceMs?: number } = {}): Promise<void> => {
    const active = Array.from(sessions.values()).filter((session) => !TERMINAL_STATUSES.has(session.status));
    for (const session of active) {
      try {
        session.pty.kill('SIGTERM');
      } catch {
        // best-effort
      }
      finish(session, null, 'SIGTERM');
    }
    if (active.length > 0 && graceMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(graceMs, 1000));
        timer.unref?.();
      });
    }
  };

  return {
    create,
    get,
    list,
    write,
    resize,
    kill,
    attach,
    detach,
    shutdownActive,
    isTerminal(status: string) {
      return TERMINAL_STATUSES.has(status);
    },
  };
}

// Map the numeric signal node-pty reports on exit back to a name. Only
// SIGTERM is ever sent by this module; anything else falls back to a
// generic label.
function signalName(signal: number): string {
  const entry = Object.entries(os.constants.signals).find(([, value]) => value === signal);
  return entry ? entry[0] : `SIG${signal}`;
}

/**
 * @module terminal-session
 *
 * Interactive-terminal session manager: the `@jini-ai/daemon`-side wiring for
 * OD's `apps/daemon/src/terminals.ts` + `apps/daemon/src/routes/terminal.ts`
 * (see `ADS-memory/reports/proposals/PROP-http-route-packs-terminal-pty-2026-07-21.md`
 * for the full design discussion this module implements a specific decision
 * from). The generic ring-buffer/coalescing/SSE-agnostic session engine
 * already exists as `@jini-ai/platform`'s `terminal.ts` (ported 2026-07-18,
 * before this task) — this module does **not** reimplement that. It adds
 * exactly the three things that engine deliberately left to a caller:
 *
 * 1. **A real `node-pty`-backed `PtySpawn`.** `@jini-ai/platform` intentionally
 *    does not depend on `node-pty` (a native compiled addon); `@jini-ai/daemon`
 *    does (see this package's `package.json` and `source-map.md`'s dated
 *    section for why that dependency now lives here, not in `@jini-ai/http-kit` or
 *    `@jini-ai/platform`). {@link loadRealSpawnPty} is the real, dynamically
 *    imported default the reference session manager below uses.
 *
 * 2. **Session-token gating.** The proposal's blocker was that a
 *    *session-scoped* dangerous capability (once a shell is spawned, every
 *    subsequent `stdin` write is arbitrary unaudited input for the
 *    session's lifetime) does not fit `ToolExecutor`'s call-scoped shape.
 *    The resolved design: `ToolExecutor.execute('terminal.create', ...)`
 *    (via {@link createTerminalToolRegistrations}) is the one full
 *    deny-by-default gated call — it authorizes *creating* a session.
 *    Every subsequent `write`/`resize`/`kill`/`attach` call against that
 *    session id is validated by a lighter, still-explicit check: this
 *    module records which `Principal` created each session at `create()`
 *    time, and every later call verifies the calling principal matches,
 *    denying (as a `'not-found'` result, never a distinguishable "forbidden"
 *    — see {@link checkOwnership}'s doc for why) otherwise. This is not
 *    "the session id is unguessable therefore secure" — it is a real,
 *    per-call identity check, independent of how hard the id is to guess.
 *
 * 3. **The kill/stdin/resize race fix.** OD's origin (and `@jini-ai/platform`'s
 *    faithful port of it) has no lock between a `kill` and a concurrent
 *    `write`/`resize` on the same session id: `kill()` only *requests* the
 *    real OS process die (sends `SIGTERM`) — the session's `status` does not
 *    flip to `'exited'` until the pty's own `onExit` callback fires,
 *    asynchronously, once the real process actually dies. A `write`/`resize`
 *    processed in that window still observes `status: 'running'` and still
 *    reaches the real pty. This module closes that window with its own
 *    immediate, lock-protected `killed` flag (see {@link runExclusive} and
 *    the `write`/`resize`/`kill` implementations below): once a `kill` call
 *    has run its own critical section, any `write`/`resize` queued behind it
 *    for the same session id sees `killed: true` and is rejected — it never
 *    depends on the real process having actually exited yet.
 */
import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';
import type { Principal, ToolPolicy, ToolRegistration } from '@jini-ai/core';
import {
  createTerminalService,
  ensureSpawnHelperExecutable,
  spawnHelperCandidatePaths,
  type PtyProcess,
  type PtySpawn,
  type PtySpawnOptions,
  type TerminalService,
  type TerminalSession as PlatformTerminalSession,
  type TerminalSseSink,
} from '@jini-ai/platform';

export type { TerminalSseSink } from '@jini-ai/platform';

/** The `ToolRegistry` id `terminal.create` executes through — see module doc §2. */
export const TERMINAL_CREATE_TOOL_ID = 'terminal.create';

/**
 * Deny-by-default `ToolPolicy` for `terminal.create`. Matching
 * `db-ops.ts`'s `denyAllDaemonDbPolicy` / `@jini-ai/deploy`'s
 * `denyAllDeployPublishPolicy` precedent: spawning an interactive shell is
 * strictly more dangerous than any of those (it is not one bounded
 * operation but an open-ended session), so a host must explicitly opt in
 * with its own policy rather than getting a working shell spawner for free
 * merely by registering the tool.
 */
export const denyAllTerminalCreatePolicy: ToolPolicy = {
  authorize: () => 'deny',
};

const daemonRequire = createRequire(import.meta.url);

/** Adapts a real `node-pty` `IPty` to `@jini-ai/platform`'s narrower `PtyProcess` port — explicit per-member mapping rather than relying on structural assignability, matching this package's established "explicit adapter, no implicit coercion" convention (e.g. `agent-executor.ts`'s `toStringEnvRecord`). */
function toPtyProcess(pty: IPty): PtyProcess {
  return {
    onData: (cb) => {
      pty.onData(cb);
    },
    onExit: (cb) => {
      pty.onExit(cb);
    },
    write: (input) => pty.write(input),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
  };
}

/**
 * The real, `node-pty`-backed {@link PtySpawn}. Dynamically imports
 * `node-pty` (mirroring OD's origin `await import('node-pty')`, not a
 * static top-level import) so a host process whose platform/environment
 * lacks a usable `node-pty` addon can still boot — only an actual
 * `terminal.create` call fails, cleanly, rather than crashing at
 * module-eval time. Before the first spawn, repairs `node-pty`'s bundled
 * `spawn-helper` binary's executable bit (pnpm unpacks it non-executable —
 * see `@jini-ai/platform`'s `terminal.ts` module doc for the full story) via
 * that package's own `spawnHelperCandidatePaths`/`ensureSpawnHelperExecutable`,
 * but with the resolver anchored at **this** module
 * (`createRequire(import.meta.url)` here, not `@jini-ai/platform`'s own
 * default): `@jini-ai/platform` deliberately does not depend on `node-pty`, so
 * its default `require.resolve('node-pty')` would not find the copy this
 * package (`@jini-ai/daemon`) actually declares — this is exactly the
 * resolver injection seam `spawnHelperCandidatePaths` was built for.
 */
export async function loadRealSpawnPty(): Promise<PtySpawn> {
  ensureSpawnHelperExecutable(
    spawnHelperCandidatePaths({ resolve: (specifier) => daemonRequire.resolve(specifier) }),
  );
  const nodePty = await import('node-pty');
  return (shell: string, args: string[], options: PtySpawnOptions) =>
    toPtyProcess(nodePty.spawn(shell, args, options));
}

/** The public, principal-neutral session snapshot this module exposes — deliberately its own shape rather than re-exporting `@jini-ai/platform`'s `TerminalSession` verbatim, since that type carries an OD-shaped per-session grouping key (see `@jini-ai/platform`'s `terminal.ts`) this module replaces entirely with the caller-supplied `resourceRef` (see {@link CreateTerminalSessionOptions}), tracked only in this module's own metadata and never forwarded to `@jini-ai/platform` at all — this package's own identifier-neutrality lint (`__tests__/identifier-lint.test.ts`) forbids that origin field's exact name from appearing anywhere in this package's source. */
export interface TerminalSessionInfo {
  readonly id: string;
  readonly resourceRef: string | null;
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

function toSessionInfo(session: PlatformTerminalSession, resourceRef: string | null): TerminalSessionInfo {
  return {
    id: session.id,
    resourceRef,
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

export interface CreateTerminalSessionOptions {
  /** Opaque grouping/scoping reference (e.g. what `@jini-ai/http-kit`'s `workspace-root.ts` resolved `cwd` from) — tracked by this module only, never forwarded to `@jini-ai/platform`. */
  readonly resourceRef?: string | null;
  readonly cwd: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly shell?: string | null;
}

export interface TerminalSessionListFilter {
  readonly resourceRef?: string;
}

export type TerminalSessionAccessResult =
  | { readonly status: 'not-found' }
  | { readonly status: 'ok'; readonly session: TerminalSessionInfo };

/**
 * Result of a `write`/`resize`/`kill` call. `'not-found'` covers both "no
 * such session" and "this session belongs to a different principal" —
 * identically, never distinguishably — see {@link checkOwnership}'s doc.
 * `'ok'` with `ok: false` covers a session that exists and is owned by the
 * caller but could not actually perform the action (already exited, killed
 * by a racing call, or the underlying pty call itself failed) — mirroring
 * `@jini-ai/platform`'s own `write`/`resize`/`kill` boolean-return contract.
 */
export type TerminalSessionActionResult =
  | { readonly status: 'not-found' }
  | { readonly status: 'ok'; readonly ok: boolean; readonly session: TerminalSessionInfo | null };

export type TerminalSessionAttachResult = 'attached' | 'ended' | 'not-found';

export interface TerminalSessionManager {
  /** The one call gated through `ToolExecutor` (see module doc §2) — this method is what `createTerminalToolRegistrations`'s handler calls, never invoked directly by a route. */
  create(principal: Principal, options: CreateTerminalSessionOptions): Promise<TerminalSessionInfo>;
  get(principal: Principal, id: string): TerminalSessionAccessResult;
  /** Sessions the given principal owns, optionally narrowed by `resourceRef`. Never returns another principal's sessions. */
  list(principal: Principal, filter?: TerminalSessionListFilter): readonly TerminalSessionInfo[];
  write(principal: Principal, id: string, input: string): Promise<TerminalSessionActionResult>;
  resize(principal: Principal, id: string, cols: number, rows: number): Promise<TerminalSessionActionResult>;
  kill(principal: Principal, id: string, signal?: string): Promise<TerminalSessionActionResult>;
  /** Replays scrollback after `lastEventId` and attaches `sink` for live output — ownership-checked the same as `write`/`resize`/`kill`, since reading a session's output is exactly as sensitive as writing to it. */
  attach(principal: Principal, id: string, lastEventId: number, sink: TerminalSseSink): TerminalSessionAttachResult;
  /** No ownership check: removing a sink that was never attached (e.g. a foreign/unknown id) is already a safe no-op at the `@jini-ai/platform` layer, and detach carries no capability of its own. */
  detach(id: string, sink: TerminalSseSink): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
}

export interface CreateTerminalSessionManagerOptions {
  /** Injected for tests (a fake session manager without a real pty) or an alternate host wiring. @default a fresh `@jini-ai/platform` `TerminalService` backed by {@link loadRealSpawnPty}. */
  readonly terminalService?: TerminalService;
  /** @default {@link loadRealSpawnPty} */
  readonly loadSpawnPty?: () => Promise<PtySpawn>;
  readonly maxEvents?: number;
  readonly maxBufferBytes?: number;
  readonly exitTailBytes?: number;
  readonly flushIntervalMs?: number;
  readonly flushThresholdBytes?: number;
  readonly ttlMs?: number;
  readonly shutdownGraceMs?: number;
}

interface SessionMetadata {
  readonly principalId: string;
  readonly resourceRef: string | null;
  killed: boolean;
}

/**
 * Serializes calls made for the same `id` through a per-id promise chain
 * (matching this codebase's `oauth-tokens.ts` `withLock` precedent), so a
 * `kill` and a concurrent `write`/`resize` against the same session never
 * interleave — see module doc §3. Self-cleans `locks` once a chain becomes
 * uncontended, so the map does not grow unbounded across a long-lived
 * daemon process's many short-lived terminal sessions.
 */
async function runExclusive<T>(locks: Map<string, Promise<unknown>>, id: string, fn: () => T): Promise<T> {
  const prior = locks.get(id) ?? Promise.resolve();
  const task = prior.catch(() => undefined).then(fn);
  locks.set(id, task);
  try {
    return await task;
  } finally {
    if (locks.get(id) === task) locks.delete(id);
  }
}

/**
 * Builds the reference `TerminalSessionManager`: an in-process wrapper
 * around a `@jini-ai/platform` `TerminalService` adding session ownership,
 * the kill/write/resize lock, and (via {@link createTerminalToolRegistrations})
 * `ToolExecutor` gating for creation. See module doc for the full design.
 */
export function createTerminalSessionManager(
  options: CreateTerminalSessionManagerOptions = {},
): TerminalSessionManager {
  const terminalService =
    options.terminalService ??
    createTerminalService({
      loadSpawnPty: options.loadSpawnPty ?? loadRealSpawnPty,
      ...(options.maxEvents !== undefined ? { maxEvents: options.maxEvents } : {}),
      ...(options.maxBufferBytes !== undefined ? { maxBufferBytes: options.maxBufferBytes } : {}),
      ...(options.exitTailBytes !== undefined ? { exitTailBytes: options.exitTailBytes } : {}),
      ...(options.flushIntervalMs !== undefined ? { flushIntervalMs: options.flushIntervalMs } : {}),
      ...(options.flushThresholdBytes !== undefined ? { flushThresholdBytes: options.flushThresholdBytes } : {}),
      ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
      ...(options.shutdownGraceMs !== undefined ? { shutdownGraceMs: options.shutdownGraceMs } : {}),
    });

  const metadata = new Map<string, SessionMetadata>();
  const locks = new Map<string, Promise<unknown>>();

  /**
   * Looks up `id`, pruning this module's own metadata if the underlying
   * `@jini-ai/platform` service has already reaped it (past its TTL) — bounds
   * `metadata`'s growth to "until the next access attempt after expiry"
   * rather than tracking every session forever.
   */
  function checkOwnership(
    principal: Principal,
    id: string,
  ): { session: PlatformTerminalSession; meta: SessionMetadata } | null {
    const session = terminalService.get(id);
    if (!session) {
      metadata.delete(id);
      return null;
    }
    const meta = metadata.get(id);
    // A session with no metadata (should not happen for anything created through this manager)
    // or a mismatched principal is reported identically to "does not exist" — never a
    // distinguishable "forbidden" — so this surface cannot be used to enumerate another
    // principal's session ids. Matches OD's own `resolveSession`: a foreign session id was
    // already a 404, not a 403.
    if (!meta || meta.principalId !== principal.id) return null;
    return { session, meta };
  }

  async function create(principal: Principal, createOptions: CreateTerminalSessionOptions): Promise<TerminalSessionInfo> {
    const session = await terminalService.create({
      cwd: createOptions.cwd,
      ...(createOptions.cols !== undefined ? { cols: createOptions.cols } : {}),
      ...(createOptions.rows !== undefined ? { rows: createOptions.rows } : {}),
      ...(createOptions.shell !== undefined ? { shell: createOptions.shell } : {}),
    });
    const resourceRef = createOptions.resourceRef ?? null;
    metadata.set(session.id, { principalId: principal.id, resourceRef, killed: false });
    return toSessionInfo(session, resourceRef);
  }

  function get(principal: Principal, id: string): TerminalSessionAccessResult {
    const found = checkOwnership(principal, id);
    return found ? { status: 'ok', session: toSessionInfo(found.session, found.meta.resourceRef) } : { status: 'not-found' };
  }

  function list(principal: Principal, filter: TerminalSessionListFilter = {}): readonly TerminalSessionInfo[] {
    const result: TerminalSessionInfo[] = [];
    for (const session of terminalService.list()) {
      const meta = metadata.get(session.id);
      if (!meta || meta.principalId !== principal.id) continue;
      if (filter.resourceRef !== undefined && meta.resourceRef !== filter.resourceRef) continue;
      result.push(toSessionInfo(session, meta.resourceRef));
    }
    return result;
  }

  /** Snapshots the current session (or null if it has meanwhile vanished) for an action result — shared by `write`/`resize`/`kill`. */
  function currentSnapshot(id: string, resourceRef: string | null): TerminalSessionInfo | null {
    const session = terminalService.get(id);
    return session ? toSessionInfo(session, resourceRef) : null;
  }

  async function write(principal: Principal, id: string, input: string): Promise<TerminalSessionActionResult> {
    const found = checkOwnership(principal, id);
    if (!found) return { status: 'not-found' };
    return runExclusive(locks, id, () => {
      // Re-read (not reuse `found.meta`) so a `kill` that ran its own critical section between
      // this call's ownership check and lock acquisition is observed — see module doc §3.
      const meta = metadata.get(id);
      if (!meta || meta.killed) {
        return { status: 'ok' as const, ok: false, session: currentSnapshot(id, meta?.resourceRef ?? null) };
      }
      const ok = terminalService.write(id, input);
      return { status: 'ok' as const, ok, session: currentSnapshot(id, meta.resourceRef) };
    });
  }

  async function resize(principal: Principal, id: string, cols: number, rows: number): Promise<TerminalSessionActionResult> {
    const found = checkOwnership(principal, id);
    if (!found) return { status: 'not-found' };
    return runExclusive(locks, id, () => {
      const meta = metadata.get(id);
      if (!meta || meta.killed) {
        return { status: 'ok' as const, ok: false, session: currentSnapshot(id, meta?.resourceRef ?? null) };
      }
      const ok = terminalService.resize(id, cols, rows);
      return { status: 'ok' as const, ok, session: currentSnapshot(id, meta.resourceRef) };
    });
  }

  async function kill(principal: Principal, id: string, signal?: string): Promise<TerminalSessionActionResult> {
    const found = checkOwnership(principal, id);
    if (!found) return { status: 'not-found' };
    return runExclusive(locks, id, () => {
      const meta = metadata.get(id);
      // Set the flag before delegating, still inside the lock: any write()/resize() queued
      // behind this call re-reads `meta.killed` once it acquires the lock (see those functions
      // above), so it observes `true` regardless of whether the real OS process has exited yet.
      if (meta) meta.killed = true;
      const ok = terminalService.kill(id, signal);
      return { status: 'ok' as const, ok, session: currentSnapshot(id, meta?.resourceRef ?? null) };
    });
  }

  function attach(principal: Principal, id: string, lastEventId: number, sink: TerminalSseSink): TerminalSessionAttachResult {
    const found = checkOwnership(principal, id);
    if (!found) return 'not-found';
    return terminalService.attach(id, lastEventId, sink);
  }

  function detach(id: string, sink: TerminalSseSink): void {
    terminalService.detach(id, sink);
  }

  async function shutdownActive(shutdownOptions?: { graceMs?: number }): Promise<void> {
    await terminalService.shutdownActive(shutdownOptions);
  }

  return { create, get, list, write, resize, kill, attach, detach, shutdownActive };
}

export interface CreateTerminalToolRegistrationsOptions {
  readonly manager: TerminalSessionManager;
  /** @default {@link denyAllTerminalCreatePolicy} — see its doc for why a permissive default was rejected. */
  readonly policy?: ToolPolicy;
  readonly requiresConfirmation?: boolean;
  readonly timeoutMs?: number;
}

export interface TerminalToolRegistrations {
  readonly create: ToolRegistration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the `{descriptor, handler, policy}` triple a host registers
 * against `@jini-ai/core`'s `ToolRegistry` so `terminal.create` becomes
 * reachable only via `ToolExecutor.execute(principal, run,
 * 'terminal.create', input)` — never by a route calling
 * `manager.create()` directly, which would bypass authorization and the
 * audit trail (matching `db-ops.ts`'s `createDaemonDbToolRegistrations`
 * precedent).
 */
export function createTerminalToolRegistrations(
  options: CreateTerminalToolRegistrationsOptions,
): TerminalToolRegistrations {
  const { manager, policy = denyAllTerminalCreatePolicy, requiresConfirmation, timeoutMs } = options;
  const descriptorExtras = {
    ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };

  return {
    create: {
      descriptor: {
        id: TERMINAL_CREATE_TOOL_ID,
        description:
          'Spawns an interactive shell session (a real PTY) rooted at a resolved working directory and returns its session id. Every subsequent write/resize/kill against that id is validated separately (see terminal-session.ts) rather than re-gated through this tool.',
        ...descriptorExtras,
      },
      policy,
      handler: async (ctx) => {
        const record = isRecord(ctx.input) ? ctx.input : {};
        const cwd = record.cwd;
        if (typeof cwd !== 'string' || cwd.length === 0) {
          throw new Error('terminal.create: input.cwd must be a non-empty string');
        }
        const resourceRef = typeof record.resourceRef === 'string' ? record.resourceRef : null;
        const cols = typeof record.cols === 'number' ? record.cols : undefined;
        const rows = typeof record.rows === 'number' ? record.rows : undefined;
        const shell = typeof record.shell === 'string' ? record.shell : null;
        return manager.create(ctx.principal, {
          resourceRef,
          cwd,
          ...(cols !== undefined ? { cols } : {}),
          ...(rows !== undefined ? { rows } : {}),
          shell,
        });
      },
    },
  };
}

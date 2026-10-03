/** Characterizes the retained host policy while public storage arguments become objects. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { SqliteDb } from '@jini-ai/db/sqlite';
import type { Server } from 'node:http';
import { closeHttpServer, installGracefulShutdown, normalizeDaemonBindHost } from '../host-bootstrap.js';
import { CORE_CAPABILITIES, JINI_PROFILES, isCapabilityId } from '../feature.js';
import { resolveSqliteBackendConfig, SqliteBackendConfigError } from '../storage/backend-config.js';
import { closeDatabase, migrate, openDatabase } from '../storage/legacy/sqlite.js';
import {
  getProject, insertProject, updateProject, deleteProject, listProjects,
  listProjectsAwaitingInput, listConversationsAwaitingInput,
} from '../store/projects/sqlite.js';

afterEach(() => { closeDatabase(); vi.useRealTimers(); });

describe('retained host and capability policy', () => {
  it('stringifies nonstring bind hosts and falls back only for nullish or blank input', () => {
    expect(normalizeDaemonBindHost(127)).toBe('127');
    expect(normalizeDaemonBindHost(false)).toBe('false');
    expect(normalizeDaemonBindHost(null)).toBe('127.0.0.1');
    expect(normalizeDaemonBindHost('   ')).toBe('127.0.0.1');
  });

  it('resolves at the hard deadline even before the close callback, and ignores its late error', async () => {
    vi.useFakeTimers();
    let callback!: (error?: Error) => void;
    const server = {
      listening: true, close: (cb: typeof callback) => { callback = cb; },
      closeIdleConnections: vi.fn(), closeAllConnections: vi.fn(),
    } as unknown as Server;
    const closed = closeHttpServer(server, { closeTimeoutMs: 50, idleCloseMs: 10 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(closed).resolves.toBeUndefined();
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    callback(new Error('late close failure'));
    await expect(closed).resolves.toBeUndefined();
  });

  it('keeps the frozen three-part embedding grant and rejects unknown capabilities', () => {
    expect(CORE_CAPABILITIES).toEqual(['run:transport', 'agent:discovery', 'tool:delegated']);
    expect(JINI_PROFILES['agent-core-v1'].grants).toEqual(CORE_CAPABILITIES);
    expect(isCapabilityId({ value: 'run:transport' })).toBe(true);
    expect(isCapabilityId({ value: 'host:exce' })).toBe(false);
    expect(isCapabilityId({ value: '__proto__' })).toBe(false);
  });

  it('installs and removes signal listeners through the supplied process port', async () => {
    const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
    const onExit = vi.fn();
    const stop = vi.fn().mockResolvedValue(undefined);
    const signalProcess = {
      on: vi.fn((signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => { listeners.set(signal, listener); }),
      off: vi.fn((signal: NodeJS.Signals) => { listeners.delete(signal); }),
      exit: onExit,
    };
    const handle = installGracefulShutdown({ stop }, { process: signalProcess });
    listeners.get('SIGTERM')!('SIGTERM');
    listeners.get('SIGINT')!('SIGINT');
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    handle.uninstall();
    expect([...listeners.keys()]).toEqual([]);
  });

  it('keeps timeout logging and exit codes through injected timer/logger ports', async () => {
    vi.useFakeTimers();
    let listener!: (signal: NodeJS.Signals) => void;
    const logger = { error: vi.fn() };
    const exit = vi.fn();
    const clearTimeoutPort = vi.fn(globalThis.clearTimeout.bind(globalThis));
    const handle = installGracefulShutdown({ stop: () => new Promise<void>(() => {}) }, {
      signals: ['SIGTERM'], timeoutMs: 25, logger,
      process: { on: (_signal, cb) => { listener = cb; }, off: vi.fn(), exit },
      timers: { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: clearTimeoutPort },
    });
    try {
      listener('SIGTERM');
      await vi.advanceTimersByTimeAsync(25);
      expect(logger.error).toHaveBeenCalledWith('[@jini-ai/server] graceful shutdown did not complete within 25ms after SIGTERM; forcing exit');
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(clearTimeoutPort).not.toHaveBeenCalled();
    } finally { handle.uninstall(); }
  });
});

describe('storage object arguments preserve errors, defaults and handle ownership', () => {
  it('keeps error names/messages, numeric-port fallback, and secure SSL fallback', () => {
    const error = new SqliteBackendConfigError({ message: 'configuration denied' });
    expect(error.name).toBe('SqliteBackendConfigError');
    expect(error.message).toBe('configuration denied');
    expect(resolveSqliteBackendConfig({}, { env: {} })).toEqual({ kind: 'sqlite' });
    expect(resolveSqliteBackendConfig({}, { env: {
      JINI_SQLITE_BACKEND: 'postgres', JINI_PG_HOST: 'h', JINI_PG_DATABASE: 'd',
      JINI_PG_USER: 'u', JINI_PG_PORT: 'nonnumeric', JINI_PG_SSL_MODE: 'unknown',
    } })).toEqual({ kind: 'postgres', postgres: { host: 'h', port: 5432, database: 'd', user: 'u', sslMode: 'require' } });
  });

  it('requires an opener before making directories and preserves acquisition failures', () => {
    const filesystem = { mkdirSync: vi.fn() };
    expect(() => openDatabase({ projectRoot: '/root' } as never, { filesystem })).toThrow('openDatabase: inject options.open');
    expect(filesystem.mkdirSync).not.toHaveBeenCalled();
    const failure = new Error('schema denied');
    const db = { pragma: vi.fn(), exec: () => { throw failure; }, close: vi.fn() } as unknown as SqliteDb;
    expect(() => openDatabase({ projectRoot: '/root', open: () => db }, { filesystem })).toThrow(failure);
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(filesystem.mkdirSync).toHaveBeenCalledWith('/root/.jini', { recursive: true });
  });

  it('retains singleton reuse, closes once, and accepts an explicit data directory', () => {
    const db = { pragma: vi.fn(), exec: vi.fn(), close: vi.fn() } as unknown as SqliteDb;
    const open = vi.fn(() => db);
    const filesystem = { mkdirSync: vi.fn() };
    const required = { projectRoot: '/root', open };
    expect(openDatabase(required, { dataDir: '/data', filesystem })).toBe(db);
    expect(openDatabase(required, { dataDir: '/data', filesystem })).toBe(db);
    expect(open).toHaveBeenCalledTimes(1);
    closeDatabase(); closeDatabase();
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('preserves CRUD nulls, normalization, patch merging and the injected clock', () => {
    const db = new Database(':memory:');
    try {
      migrate({ db });
      expect(insertProject({ db, project: { id: 'p', name: 'Before', createdAt: 1, updatedAt: 2, metadata: { a: 1 } } })).toMatchObject({ id: 'p', metadata: { a: 1 } });
      const clock = { now: vi.fn(() => 77) };
      expect(updateProject({ db, id: 'p', patch: { name: 'After' } }, { clock })).toMatchObject({ name: 'After', metadata: { a: 1 }, updatedAt: 77 });
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(updateProject({ db, id: 'p', patch: { updatedAt: 88 } }, { clock })).toMatchObject({ updatedAt: 88 });
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(listProjects({ db }).map(row => row.id)).toEqual(['p']);
      expect(updateProject({ db, id: 'missing', patch: {} })).toBeNull();
      deleteProject({ db, id: 'p' });
      expect(getProject({ db, id: 'p' })).toBeNull();
    } finally { db.close(); }
  });
});

describe('awaiting input ranks form-bearing turns, not every assistant turn', () => {
  for (const tag of ['question-form', 'ask-question']) {
    it(`keeps an unanswered ${tag} visible after a newer plain assistant turn, until the user replies`, () => {
      const db = new Database(':memory:');
      try {
        // Minimal tables isolate the existing SQL selection and timestamp/position ordering.
        db.exec(`CREATE TABLE conversations (id TEXT, project_id TEXT);
          CREATE TABLE messages (conversation_id TEXT, role TEXT, content TEXT, created_at INTEGER, position INTEGER);
          INSERT INTO conversations VALUES ('c', 'p');`);
        const put = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
        put.run('c', 'assistant', `<${tag}>question</${tag}>`, 1, 1);
        put.run('c', 'assistant', 'newer plain turn', 2, 2);
        expect(listProjectsAwaitingInput({ db })).toEqual(new Set(['p']));
        expect(listConversationsAwaitingInput({ db })).toEqual(new Set(['c']));
        // Same timestamp with a greater position is still a subsequent reply.
        put.run('c', 'user', 'answer', 1, 3);
        expect(listProjectsAwaitingInput({ db })).toEqual(new Set());
        expect(listConversationsAwaitingInput({ db })).toEqual(new Set());
      } finally { db.close(); }
    });
  }
});

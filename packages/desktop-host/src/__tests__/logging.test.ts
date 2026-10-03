import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendLogLine,
  createFileLogger,
  installFatalExceptionHandlers,
  isHarmlessSocketOptionError,
} from '../logging.js';

describe('isHarmlessSocketOptionError', () => {
  it('matches the setTypeOfService EINVAL shape with an authoritative code', () => {
    const error = Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL' });
    expect(isHarmlessSocketOptionError({ value: error })).toBe(true);
  });

  it('rejects a contradicting structured code even if the message contains EINVAL', () => {
    const error = Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EACCES' });
    expect(isHarmlessSocketOptionError({ value: error })).toBe(false);
  });

  it('falls back to message matching when no structured code is present', () => {
    expect(isHarmlessSocketOptionError({ value: new Error('setTypeOfService EINVAL') })).toBe(true);
    expect(isHarmlessSocketOptionError({ value: new Error('some other error') })).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isHarmlessSocketOptionError({ value: 'boom' })).toBe(false);
  });

  it('returns false when an Error-like value has a non-string message', () => {
    // Bypass the `Error` constructor's string coercion so `message` is
    // genuinely not a string, exercising the `typeof value.message ===
    // 'string'` ternary's fallback-to-empty-string branch.
    const weird = Object.create(Error.prototype) as { message: unknown };
    weird.message = 123;
    expect(isHarmlessSocketOptionError({ value: weird })).toBe(false);
  });
});

describe('appendLogLine', () => {
  it('returns false when the append function throws instead of propagating', () => {
    const append = vi.fn(() => {
      throw Object.assign(new Error('too many files'), { code: 'EMFILE' });
    });
    expect(appendLogLine({ logPath: '/tmp/should-not-be-created.log', line: '{"level":"error"}\n' }, { append })).toBe(false);
    expect(append).toHaveBeenCalledWith({ path: '/tmp/should-not-be-created.log', data: '{"level":"error"}\n', encoding: 'utf8' });
  });
});

describe('createFileLogger', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir != null) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('appends JSON lines to the log file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    logger.info({ message: 'starting up' }, { meta: { pid: 123 } });
    logger.error({ message: 'boom' }, { meta: { error: new Error('bad') } });
    const contents = await readFile(logPath, 'utf8');
    const lines = contents.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ level: 'info', message: 'starting up', meta: { pid: 123 } });
    expect(lines[1]).toMatchObject({ level: 'error', message: 'boom' });
    expect(lines[1].meta.error).toMatchObject({ message: 'bad' });
  });

  it('omits the meta field entirely when no meta is provided', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-no-meta.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    logger.info({ message: 'no meta here' });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line).toMatchObject({ level: 'info', message: 'no meta here' });
    expect(line.meta).toBeUndefined();
  });

  it('passes non-Error values assigned to error/reason meta keys through unchanged', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-non-error-reason.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    logger.warn({ message: 'plain reason' }, { meta: { reason: 'just a string, not an Error' } });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line.meta.reason).toBe('just a string, not an Error');
  });

  it('falls back to a serializationError entry when the meta cannot be JSON-serialized', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-circular.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.warn({ message: 'circular meta' }, { meta: { detail: circular } });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line.level).toBe('warn');
    expect(typeof line.meta.serializationError).toBe('string');
  });

  it('stringifies a non-Error thrown value in the serializationError fallback', async () => {
    // JSON.stringify can throw a non-Error value when a nested `toJSON`
    // implementation itself throws a primitive, exercising the
    // `error instanceof Error ? ... : String(error)` ternary's fallback arm.
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-non-error-throw.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    const poisoned = {
      toJSON() {
        throw 'not an Error instance';
      },
    };
    logger.warn({ message: 'poisoned meta' }, { meta: { detail: poisoned } });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line.meta.serializationError).toBe('not an Error instance');
  });

  it('echoes to the matching console method for every level when echoToConsole defaults to true', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-echo.log');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const logger = createFileLogger({ logPath });
      logger.error({ message: 'e' });
      logger.info({ message: 'i' });
      logger.warn({ message: 'w' });
      expect(errorSpy).toHaveBeenCalledWith('e', '');
      expect(infoSpy).toHaveBeenCalledWith('i', '');
      expect(warnSpy).toHaveBeenCalledWith('w', '');
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('installFatalExceptionHandlers', () => {
  it('swallows a harmless uncaughtException and does not remove itself', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const uninstall = installFatalExceptionHandlers({ logger });
    const listenersBefore = process.listenerCount('uncaughtException');
    const harmless = Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL' });
    process.emit('uncaughtException', harmless);
    expect(logger.warn).toHaveBeenCalledWith({ message: 'swallowed harmless uncaught exception' }, { meta: { error: harmless } });
    expect(process.listenerCount('uncaughtException')).toBe(listenersBefore);
    uninstall();
  });

  it('uninstall removes both handlers', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const before = { unc: process.listenerCount('uncaughtException'), rej: process.listenerCount('unhandledRejection') };
    const uninstall = installFatalExceptionHandlers({ logger });
    expect(process.listenerCount('uncaughtException')).toBe(before.unc + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(before.rej + 1);
    uninstall();
    expect(process.listenerCount('uncaughtException')).toBe(before.unc);
    expect(process.listenerCount('unhandledRejection')).toBe(before.rej);
  });

  it('swallows a harmless unhandledRejection and does not remove itself', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const uninstall = installFatalExceptionHandlers({ logger });
    const listenersBefore = process.listenerCount('unhandledRejection');
    const harmless = Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL' });
    process.emit('unhandledRejection', harmless, Promise.resolve());
    expect(logger.warn).toHaveBeenCalledWith({ message: 'swallowed harmless unhandled rejection' }, { meta: { reason: harmless } });
    expect(process.listenerCount('unhandledRejection')).toBe(listenersBefore);
    uninstall();
  });

  // Mirrors the OD original's #906 regression coverage
  // (apps/packaged/tests/logging.test.ts): the non-harmless branch must
  // log at error level, detach itself from the emitter BEFORE scheduling
  // the rethrow (otherwise the rethrow re-enters the same listener and
  // loops forever instead of letting Node's default crash path take
  // over), and the rethrow must carry the original error. `setImmediate`
  // is stubbed so the captured callback can be invoked manually inside
  // `expect(...).toThrow()` instead of crashing the test worker.
  it('logs and rethrows a non-harmless uncaughtException after detaching the listener', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scheduled: Array<() => void> = [];
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as NodeJS.Immediate;
    }) as typeof setImmediate);
    const uninstall = installFatalExceptionHandlers({ logger });
    try {
      const before = process.listenerCount('uncaughtException');
      const real = new Error('real bug');
      process.emit('uncaughtException', real);
      expect(logger.error).toHaveBeenCalledWith({ message: 'fatal uncaught exception' }, { meta: { error: real } });
      expect(process.listenerCount('uncaughtException')).toBe(before - 1);
      expect(scheduled).toHaveLength(1);
      expect(() => scheduled[0]!()).toThrow(real);
    } finally {
      setImmediateSpy.mockRestore();
      uninstall();
    }
  });

  it('logs and rethrows a non-harmless unhandledRejection after detaching the listener', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scheduled: Array<() => void> = [];
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((fn: () => void) => {
      scheduled.push(fn);
      return 0 as unknown as NodeJS.Immediate;
    }) as typeof setImmediate);
    const uninstall = installFatalExceptionHandlers({ logger });
    try {
      const before = process.listenerCount('unhandledRejection');
      const real = new Error('rejected for real');
      process.emit('unhandledRejection', real, Promise.resolve());
      expect(logger.error).toHaveBeenCalledWith({ message: 'fatal unhandled rejection' }, { meta: { reason: real } });
      expect(process.listenerCount('unhandledRejection')).toBe(before - 1);
      expect(scheduled).toHaveLength(1);
      expect(() => scheduled[0]!()).toThrow(real);
    } finally {
      setImmediateSpy.mockRestore();
      uninstall();
    }
  });
});

// REGRESSION: fails if Logger's optional error is ignored by createFileLogger.
it('serializes the core Logger error bag alongside structured metadata', () => {
  const lines: string[] = [];
  const logger = createFileLogger({ logPath: '/unused' }, { echoToConsole: false, append: ({ data }) => { lines.push(data); } });
  for (const level of ['info', 'warn', 'error'] as const) {
    logger[level]({ message: level }, { meta: { context: 'host' }, error: new Error('detail') });
  }
  expect(lines.map(line => JSON.parse(line))).toMatchObject([
    { level: 'info', meta: { context: 'host', error: { message: 'detail', name: 'Error' } } },
    { level: 'warn', meta: { context: 'host', error: { message: 'detail', name: 'Error' } } },
    { level: 'error', meta: { context: 'host', error: { message: 'detail', name: 'Error' } } },
  ]);
});

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
    expect(lines[1].meta.error).toBe('Error');
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

  // A rejection reason can be any value, including a string that quotes a secret: only its type is written.
  it('writes only the type of a non-Error value assigned to error/reason meta keys', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-non-error-reason.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    logger.warn({ message: 'plain reason' }, { meta: { reason: 'just a string, not an Error' } });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line.meta.reason).toBe('string');
  });

  // Meta is projected before it is written, so a cycle ends at a fixed depth instead of failing
  // the whole line.
  it('ends a circular meta at a fixed depth placeholder instead of failing the line', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-log-'));
    const logPath = join(dir, 'host-circular.log');
    const logger = createFileLogger({ logPath }, { echoToConsole: false });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.warn({ message: 'circular meta' }, { meta: { detail: circular } });
    const contents = await readFile(logPath, 'utf8');
    const line = JSON.parse(contents.trim());
    expect(line.level).toBe('warn');
    expect(line.meta).toEqual({ detail: { self: { self: { self: '[nested too deep]' } } } });
  });

  it('never calls a meta value\'s own toJSON: functions are written as fixed words', async () => {
    // A `toJSON` is caller-controlled code that could return or throw anything; the projection
    // writes it as `[function]` and never invokes it.
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
    expect(line.meta).toEqual({ detail: { toJSON: '[function]' } });
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
    { level: 'info', meta: { context: 'host', error: 'Error' } },
    { level: 'warn', meta: { context: 'host', error: 'Error' } },
    { level: 'error', meta: { context: 'host', error: 'Error' } },
  ]);
});

it('echoes metadata and the error bag to the injected console exactly as it writes them (class only)', () => {
  const echoed: unknown[][] = [];
  const out = { error: (...args: unknown[]) => { echoed.push(['error', ...args]); }, info: (...args: unknown[]) => { echoed.push(['info', ...args]); }, warn: (...args: unknown[]) => { echoed.push(['warn', ...args]); } };
  const lines: string[] = [];
  const logger = createFileLogger({ logPath: '/unused' }, { console: out, append: ({ data }) => { lines.push(data); } });
  const error = new Error('detail');
  for (const level of ['error', 'info', 'warn'] as const) {
    logger[level]({ message: `${level} with meta` }, { meta: { context: 'host' } });
    logger[level]({ message: `${level} with error` }, { meta: { context: 'host' }, error });
  }
  expect(echoed).toEqual([
    ['error', 'error with meta', { context: 'host' }], ['error', 'error with error', { context: 'host', error: 'Error' }],
    ['info', 'info with meta', { context: 'host' }], ['info', 'info with error', { context: 'host', error: 'Error' }],
    ['warn', 'warn with meta', { context: 'host' }], ['warn', 'warn with error', { context: 'host', error: 'Error' }],
  ]);
  expect(lines).toHaveLength(6);
});

// The default file and echo carry safe metadata only (class + approved code): a caught error's text
// or stack can quote untrusted input or a credential, and a console tee cannot protect the file write.
it('never writes or echoes an error message, stack or name, including fatal-handler meta', () => {
  const echoed: unknown[][] = [];
  const out = { error: (...args: unknown[]) => { echoed.push(args); }, info: (...args: unknown[]) => { echoed.push(args); }, warn: (...args: unknown[]) => { echoed.push(args); } };
  const lines: string[] = [];
  const logger = createFileLogger({ logPath: '/unused' }, { console: out, append: ({ data }) => { lines.push(data); } });
  const secretError = Object.assign(new RangeError('boom api_key=SECRETSECRETSECRETSECRET'), { name: 'SECRETSECRETNAME' });
  logger.error({ message: 'fatal uncaught exception' }, { meta: { error: secretError } });
  logger.warn({ message: 'fatal unhandled rejection' }, { meta: { reason: secretError } });
  logger.error({ message: 'bag' }, { error: secretError });
  expect(lines.map(line => JSON.parse(line).meta)).toEqual([{ error: 'RangeError' }, { reason: 'RangeError' }, { error: 'RangeError' }]);
  expect(echoed).toEqual([['fatal uncaught exception', { error: 'RangeError' }], ['fatal unhandled rejection', { reason: 'RangeError' }], ['bag', { error: 'RangeError' }]]);
  const written = JSON.stringify([lines, echoed]);
  for (const forbidden of ['boom', 'SECRETSECRET', 'logging.test.ts']) expect(written).not.toContain(forbidden);
});

it('hands the full record to an injected host diagnostics sink; a throwing sink never stops the file line', () => {
  const lines: string[] = [];
  const records: unknown[] = [];
  const error = new Error('boom detail');
  const logger = createFileLogger({ logPath: '/unused' }, { echoToConsole: false, append: ({ data }) => { lines.push(data); }, diagnostics: record => { records.push(record); } });
  logger.error({ message: 'stopped' }, { meta: { runId: 'run-1' }, error });
  expect(records).toEqual([{ level: 'error', message: 'stopped', meta: { runId: 'run-1' }, error }]);
  expect((records[0] as { error: unknown }).error).toBe(error);
  expect(JSON.parse(lines[0]!).meta).toEqual({ runId: 'run-1', error: 'Error' });
  const failing = createFileLogger({ logPath: '/unused' }, { echoToConsole: false, append: ({ data }) => { lines.push(data); }, diagnostics: () => { throw new Error('sink down'); } });
  expect(() => failing.warn({ message: 'kept' }, { error })).not.toThrow();
  expect(lines.some(line => JSON.parse(line).message === 'kept')).toBe(true);
});

// Nested meta is projected at every depth: an error inside `detail` is still a caught value, and its
// enumerable fields (an arbitrary `code`) must not reach the JSON file either.
it('writes nested errors as their class and opaque objects as fixed words, in the file and the echo', () => {
  const echoed: unknown[][] = [];
  const out = { error: (...args: unknown[]) => { echoed.push(args); }, info: (...args: unknown[]) => { echoed.push(args); }, warn: (...args: unknown[]) => { echoed.push(args); } };
  const lines: string[] = [];
  const logger = createFileLogger({ logPath: '/unused' }, { console: out, append: ({ data }) => { lines.push(data); } });
  const secretError = Object.assign(new RangeError('boom api_key=SECRETSECRETSECRETSECRET'), { code: 'SECRETSECRETCODE' });
  logger.error({ message: 'nested' }, { meta: { detail: { error: secretError, items: [secretError] }, opaque: new Map([['k', 'SECRETSECRETMAP']]) } });
  const expected = { detail: { error: 'RangeError', items: ['RangeError'] }, opaque: '[object]' };
  expect(JSON.parse(lines[0]!).meta).toEqual(expected);
  expect(echoed).toEqual([['nested', expected]]);
  const written = JSON.stringify([lines, echoed]);
  for (const forbidden of ['boom', 'SECRETSECRET', 'logging.test.ts']) expect(written).not.toContain(forbidden);
});

// A plain thrown object (`throw { message, stack }`) is a caught value as much as an Error is: the
// file line and the echo write fixed words for it, nested or as the whole meta.
it('writes plain error-shaped objects as fixed words, in the file and the echo', () => {
  const echoed: unknown[][] = [];
  const out = { error: (...args: unknown[]) => { echoed.push(args); }, info: (...args: unknown[]) => { echoed.push(args); }, warn: (...args: unknown[]) => { echoed.push(args); } };
  const lines: string[] = [];
  const logger = createFileLogger({ logPath: '/unused' }, { console: out, append: ({ data }) => { lines.push(data); } });
  const thrown = { message: 'boom PRIVATEVALUE', stack: 'PRIVATEVALUE at logging.test.ts' };
  logger.error({ message: 'nested' }, { meta: { detail: thrown, items: [{ message: 'PRIVATEVALUE' }] } });
  logger.error({ message: 'whole' }, { meta: thrown });
  expect(lines.map(line => JSON.parse(line).meta)).toEqual([{ detail: 'object', items: ['object'] }, { meta: 'object' }]);
  expect(JSON.stringify([lines, echoed])).not.toContain('PRIVATEVALUE');
});

// A log call sits inside a catch block: hostile meta must not throw, and the host sink still gets
// the original record.
it('contains hostile getters and proxies in meta; the file line and the host sink both still happen', () => {
  const lines: string[] = [];
  const records: unknown[] = [];
  const hostile = Object.defineProperty({}, 'detail', { enumerable: true, get() { throw new Error('getter SECRETSECRETGETTER'); } });
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  const trapping = new Proxy({}, { ownKeys() { throw new Error('ownKeys SECRETSECRETKEYS'); } });
  const logger = createFileLogger({ logPath: '/unused' }, { echoToConsole: false, append: ({ data }) => { lines.push(data); }, diagnostics: record => { records.push(record); } });
  expect(() => logger.error({ message: 'hostile' }, { meta: hostile })).not.toThrow();
  expect(() => logger.error({ message: 'revoked' }, { meta: { revoked } })).not.toThrow();
  expect(() => logger.error({ message: 'keys' }, { meta: trapping })).not.toThrow();
  expect(lines.map(line => JSON.parse(line).meta)).toEqual([{ detail: '[unreadable]' }, { revoked: '[unreadable]' }, { meta: '[unreadable]' }]);
  expect(records).toHaveLength(3);
  expect((records[0] as { meta: unknown }).meta).toBe(hostile);
  expect(lines.join('')).not.toContain('SECRETSECRET');
});

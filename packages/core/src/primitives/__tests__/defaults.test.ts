import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConsoleLogger, createRandomUuidGenerator, createSystemClock, nowIso, toIsoDateTime,
} from '../index.js';

// The adapters must use the real host APIs, while application code can inject deterministic ports.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('primitive default adapters', () => {
  it('reads the current wall clock on every call and formats one clock sample in UTC', () => {
    const epochMs = Date.parse('2026-10-02T12:34:56.789Z');
    const wallClock = vi.spyOn(Date, 'now').mockReturnValueOnce(epochMs).mockReturnValueOnce(epochMs + 1);
    const clock = createSystemClock();
    expect(clock.nowMs()).toBe(epochMs);
    expect(clock.nowMs()).toBe(epochMs + 1);
    expect(wallClock).toHaveBeenCalledTimes(2);
    const nowMs = vi.fn(() => epochMs);
    expect(nowIso({ clock: { nowMs } })).toBe('2026-10-02T12:34:56.789Z');
    expect(nowMs).toHaveBeenCalledTimes(1);
    expect(nowMs).toHaveBeenCalledWith();
    expect(toIsoDateTime({ epochMs: 0 })).toBe('1970-01-01T00:00:00.000Z');
    expect(() => toIsoDateTime({ epochMs: NaN })).toThrow(RangeError);
  });

  it('delegates each new ID to the host cryptographic UUID getter', () => {
    const first = 'e94c02ef-0806-4bcd-85e5-28a8062aa208';
    const second = '31776d4d-e05b-4912-87b1-6dc80c46dbef';
    const randomUUID = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.stubGlobal('crypto', { randomUUID });
    const ids = createRandomUuidGenerator();
    expect(ids.newId()).toBe(first);
    expect(ids.newId()).toBe(second);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(randomUUID.mock.calls).toEqual([[], []]);
  });

  it('fails when no cryptographic UUID implementation exists', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createRandomUuidGenerator().newId()).toThrow(TypeError);
  });

  it('sends each severity, prefix, metadata and error to the matching console method', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createConsoleLogger({ prefix: '[host]' });
    const meta = { runId: 'run-1' };
    const cause = new Error('failed');
    logger.info({ message: 'ready' });
    logger.warn({ message: 'retry' }, { meta });
    logger.error({ message: 'stopped' }, { meta, error: cause });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('[host] ready');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[host] retry', meta);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[host] stopped', meta, 'Error');
    createConsoleLogger({ prefix: '' }).info({ message: 'plain' });
    expect(info).toHaveBeenLastCalledWith('plain');
  });

  // The default console adapter writes safe metadata only: a caught error's text can quote
  // untrusted input or a credential no redaction pattern knows. Full detail needs a host sink.
  it('writes only the error class, never its message, stack or name, for the error bag and for error-valued meta', () => {
    const lines: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args); });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const logger = createConsoleLogger({ prefix: '[host]' });
    const secretError = Object.assign(new TypeError('boom api_key=SECRETSECRETSECRETSECRET'), { name: 'SECRETSECRETNAME' });
    logger.error({ message: 'stopped' }, { meta: { runId: 'run-1', reason: secretError }, error: secretError });
    logger.warn({ message: 'retry' }, { meta: { error: 'plain text reason SECRETSECRET' } });
    expect(lines).toEqual([['[host] stopped', { runId: 'run-1', reason: 'TypeError' }, 'TypeError'], ['[host] retry', { error: 'string' }]]);
    const printed = JSON.stringify(lines);
    for (const forbidden of ['boom', 'SECRETSECRET', 'defaults.test.ts']) expect(printed).not.toContain(forbidden);
  });

  it('hands the full record to an injected host sink and keeps the console line metadata-only, even when the sink throws', () => {
    const lines: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const records: unknown[] = [];
    const cause = new Error('boom api_key=SECRETSECRETSECRETSECRET');
    createConsoleLogger({ prefix: '[host]' }, { diagnostics: record => { records.push(record); } })
      .error({ message: 'stopped' }, { meta: { runId: 'run-1' }, error: cause });
    expect(records).toEqual([{ level: 'error', message: '[host] stopped', meta: { runId: 'run-1' }, error: cause }]);
    expect((records[0] as { error: unknown }).error).toBe(cause);
    expect(lines).toEqual([['[host] stopped', { runId: 'run-1' }, 'Error']]);
    createConsoleLogger({ prefix: '' }, { diagnostics: () => { throw new Error('sink down'); } }).error({ message: 'still logged' }, { error: cause });
    expect(lines[1]).toEqual(['still logged', 'Error']);
  });

  // Nested metadata is projected the same way at every depth: an error two levels down is still a
  // caught value, and an opaque object (a response, a Map) can carry anything.
  it('projects nested metadata: nested errors become their class, opaque objects become fixed words', () => {
    const lines: unknown[][] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const secretError = Object.assign(new TypeError('boom api_key=SECRETSECRETSECRETSECRET'), { code: 'SECRETSECRETCODE' });
    class Response { readonly body = 'SECRETSECRETBODY'; }
    const circular: Record<string, unknown> = { runId: 'run-1' };
    circular.self = circular;
    createConsoleLogger({ prefix: '' }).warn({ message: 'retry' }, {
      meta: { detail: { error: secretError, list: [secretError, 'kept'], response: new Response(), map: new Map([['k', 'SECRETSECRETMAP']]) }, circular, count: 2n, fn: () => 'SECRETSECRETFN' },
    });
    expect(lines).toEqual([['retry', {
      detail: { error: 'TypeError', list: ['TypeError', 'kept'], response: '[object]', map: '[object]' },
      circular: { runId: 'run-1', self: { runId: 'run-1', self: { runId: 'run-1', self: '[nested too deep]' } } },
      count: '2',
      fn: '[function]',
    }]]);
    const printed = JSON.stringify(lines);
    for (const forbidden of ['boom', 'SECRETSECRET', 'defaults.test.ts']) expect(printed).not.toContain(forbidden);
  });

  // A log call sits inside a catch block: hostile metadata must never replace the failure being
  // logged, and the host sink must still receive the original record.
  it('contains hostile getters and proxies in metadata; the console line and the host sink both still happen', () => {
    const lines: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const records: unknown[] = [];
    let reads = 0;
    const hostile = Object.defineProperty({ runId: 'run-1' }, 'detail', {
      enumerable: true,
      get() { reads += 1; if (reads > 1) return 'SECRETSECRETSECONDREAD'; throw new Error('getter SECRETSECRETGETTER'); },
    });
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    const trapping = new Proxy({}, { ownKeys() { throw new Error('ownKeys SECRETSECRETKEYS'); } });
    const getTrap = new Proxy({ a: 1 }, { get() { throw new Error('get SECRETSECRETGET'); } });
    const logger = createConsoleLogger({ prefix: '' }, { diagnostics: record => { records.push(record); } });
    expect(() => logger.error({ message: 'stopped' }, { meta: { nested: hostile, revoked, getTrap } })).not.toThrow();
    expect(() => logger.error({ message: 'keys' }, { meta: trapping })).not.toThrow();
    expect(lines).toEqual([
      ['stopped', { nested: { runId: 'run-1', detail: '[unreadable]' }, revoked: '[unreadable]', getTrap: { a: '[unreadable]' } }],
      ['keys', { meta: '[unreadable]' }],
    ]);
    expect(reads).toBe(1);
    expect(records).toHaveLength(2);
    expect((records[0] as { meta: { nested: unknown } }).meta.nested).toBe(hostile);
    expect(JSON.stringify(lines)).not.toContain('SECRETSECRET');
  });
});

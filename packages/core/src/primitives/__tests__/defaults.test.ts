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
    expect(error).toHaveBeenCalledWith('[host] stopped', meta, cause);
    createConsoleLogger({ prefix: '' }).info({ message: 'plain' });
    expect(info).toHaveBeenLastCalledWith('plain');
  });
});

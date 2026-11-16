import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRandomUuidGenerator, createSystemClock } from '../system.js';

// The adapters must use the real host APIs, while application code can inject deterministic ports.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('system adapters', () => {
  it('reads the current wall clock on every call', () => {
    const epochMs = Date.parse('2026-10-02T12:34:56.789Z');
    const wallClock = vi.spyOn(Date, 'now').mockReturnValueOnce(epochMs).mockReturnValueOnce(epochMs + 1);
    const clock = createSystemClock();
    expect(clock.nowMs()).toBe(epochMs);
    expect(clock.nowMs()).toBe(epochMs + 1);
    expect(wallClock).toHaveBeenCalledTimes(2);
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
});

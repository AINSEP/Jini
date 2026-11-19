import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_READ_BYTES, PayloadTooLargeError, readStreamText } from '../prompt.js';

describe('readStreamText', () => {
  it('concatenates every chunk as UTF-8 text', async () => {
    const input = new PassThrough();
    const reading = readStreamText({ input });
    input.write('{"supa');
    input.end(Buffer.from('base":"tok-é"}'));
    await expect(reading).resolves.toBe('{"supabase":"tok-é"}');
  });

  it('round-trips a multibyte character split across chunks', async () => {
    const input = new PassThrough();
    const reading = readStreamText({ input });
    const bytes = Buffer.from('é');
    input.write(bytes.subarray(0, 1));
    input.end(bytes.subarray(1));
    await expect(reading).resolves.toBe('é');
  });

  it('rejects 11 bytes against a 10-byte cap and pauses the stream', async () => {
    const input = new PassThrough();
    const pause = vi.spyOn(input, 'pause');
    const reading = readStreamText({ input }, { maxBytes: 10 });
    const rejection = expect(reading).rejects.toBeInstanceOf(PayloadTooLargeError);
    input.write('0123456789');
    input.write('!');
    await rejection;
    expect(pause).toHaveBeenCalledOnce();
    expect(input.isPaused()).toBe(true);
    input.destroy();
  });

  it('rejects an already-aborted signal with its reason before reading', async () => {
    const input = new PassThrough();
    const setEncoding = vi.spyOn(input, 'setEncoding');
    const controller = new AbortController();
    const reason = new Error('cancelled before reading');
    controller.abort(reason);
    await expect(readStreamText({ input }, { signal: controller.signal })).rejects.toBe(reason);
    expect(setEncoding).not.toHaveBeenCalled();
    input.destroy();
  });

  it('rejects a mid-read abort with its reason', async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const reason = new Error('cancelled during reading');
    const reading = readStreamText({ input }, { signal: controller.signal });
    const rejection = expect(reading).rejects.toBe(reason);
    input.write('partial');
    controller.abort(reason);
    await rejection;
    expect(input.isPaused()).toBe(true);
    input.destroy();
  });

  it('removes stream and abort listeners after end', async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reading = readStreamText({ input }, { signal: controller.signal });
    input.end('done');
    await expect(reading).resolves.toBe('done');
    expect(input.listenerCount('data')).toBe(0);
    expect(input.listenerCount('end')).toBe(0);
    expect(input.listenerCount('error')).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('uses a default cap of 10 MiB', () => {
    expect(DEFAULT_MAX_READ_BYTES).toBe(10 * 1024 * 1024);
  });
});

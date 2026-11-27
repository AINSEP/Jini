import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError } from '../prompt.js';
import { readStdinRequestLine } from '../stdin-line.js';

describe('readStdinRequestLine', () => {
  it('returns the first line without waiting for the stream to end', async () => {
    const input = new PassThrough();
    const stop = new AbortController();
    const line = readStdinRequestLine({ input, stop });
    input.write('{"file":');
    input.write('"/a.zip"}\nignored later bytes');
    expect(await line).toBe('{"file":"/a.zip"}');
    expect(stop.signal.aborted).toBe(false);
  });

  it('aborts stop with the stopped() reason when the stream ends after the line, and unrefs it', async () => {
    const input = Object.assign(new PassThrough(), { unrefCalls: 0, unref() { this.unrefCalls += 1; } });
    const stop = new AbortController();
    const reason = new Error('stopped by the parent');
    const line = readStdinRequestLine({ input, stop }, { stopped: () => reason });
    input.write('{"file":"/a.zip"}\n');
    await line;
    expect(input.unrefCalls).toBe(1);
    const aborted = new Promise(resolve => stop.signal.addEventListener('abort', resolve));
    input.end();
    await aborted;
    expect(stop.signal.reason).toBe(reason);
  });

  for (const [name, finish] of [['closed', (i: EventEmitter) => i.emit('close')], ['broken', (i: EventEmitter) => i.emit('error', new Error('EPIPE'))]] as const) {
    it(`aborts when the stream is ${name} after the line`, async () => {
      const input = new EventEmitter();
      const stop = new AbortController();
      const line = readStdinRequestLine({ input: input as never, stop });
      input.emit('data', Buffer.from('{"file":"/a.zip"}\n'));
      await line;
      finish(input);
      expect(stop.signal.aborted).toBe(true);
    });
  }

  it('treats input that ends with no newline as the request, with nothing to stop', async () => {
    const input = new PassThrough();
    const stop = new AbortController();
    const line = readStdinRequestLine({ input, stop });
    input.end('{"file":"/a.zip"}');
    expect(await line).toBe('{"file":"/a.zip"}');
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(input.destroyed).toBe(true);
    expect(stop.signal.aborted).toBe(false);
  });

  for (const [name, chunk] of [['with no newline', 'x'.repeat(16 * 1024 + 1)], ['whose newline comes past the cap', 'x'.repeat(16 * 1024 + 1) + '\n']] as const) {
    it(`rejects a line ${name} with PayloadTooLargeError by default`, async () => {
      const input = new PassThrough();
      const line = readStdinRequestLine({ input, stop: new AbortController() });
      input.write(chunk);
      await expect(line).rejects.toBeInstanceOf(PayloadTooLargeError);
    });
  }

  it('reads a line exactly at the cap, and honours maxBytes and tooLarge', async () => {
    const exact = new PassThrough();
    const line = readStdinRequestLine({ input: exact, stop: new AbortController() });
    exact.write('x'.repeat(16 * 1024) + '\n');
    expect((await line).length).toBe(16 * 1024);
    const small = new PassThrough();
    const refused = readStdinRequestLine({ input: small, stop: new AbortController() }, { maxBytes: 3, tooLarge: () => new RangeError('custom') });
    small.write('abcd\n');
    await expect(refused).rejects.toThrow(RangeError);
  });
});

it('discards bytes after the request and aborts on EOF with the default reason', async () => {
  const input = Object.assign(new PassThrough(), { unrefCalls: 0, unref() { this.unrefCalls += 1; } });
  const stop = new AbortController();
  const request = readStdinRequestLine({ input, stop }, { maxBytes: 4 });
  input.write('open\n');
  expect(await request).toBe('open');
  input.write('more than four bytes');
  expect(input.unrefCalls).toBe(1);
  expect(stop.signal.aborted).toBe(false);

  const aborted = new Promise<void>((resolve) => stop.signal.addEventListener('abort', () => resolve(), { once: true }));
  input.end();
  await aborted;
  expect(stop.signal.reason).toBeInstanceOf(Error);
  expect(stop.signal.reason.message).toBe('The input ended, so the operation was stopped.');
});

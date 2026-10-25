/**
 * @file Exact byte caps of the default prompt readers (stdin and file), counted in UTF-8 BYTES: a
 * payload of exactly `maxBytes` is accepted, one more byte is refused with PayloadTooLargeError
 * naming the limit, and stdin is paused and released on refusal. Also the depth/entry caps of
 * `sanitizeUnknownDeep` at their exact edge. Closes L10 survivors at prompt.ts:141,173,176 and
 * redact.ts:36,39. process.stdin is a typed EventEmitter fake; files are real temp files.
 */
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError, readBodyFromFlags, readPromptFromFlags } from '../prompt.js';
import { sanitizeUnknownDeep } from '../redact.js';

async function withFakeStdin<T>(run: (stdin: EventEmitter & { paused: number }) => Promise<T>): Promise<T> {
  const fake = Object.assign(new EventEmitter(), { paused: 0, setEncoding: () => undefined, pause() { fake.paused += 1; } });
  const original = process.stdin;
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try { return await run(fake); } finally { Object.defineProperty(process, 'stdin', { value: original, configurable: true }); }
}

describe('default stdin reader cap', () => {
  it('accepts exactly maxBytes (counted in UTF-8 bytes) across chunks', async () => {
    await withFakeStdin(async (stdin) => {
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { maxBytes: 4 });
      stdin.emit('data', 'é'); // 2 bytes
      stdin.emit('data', 'ab');
      stdin.emit('end');
      await expect(pending).resolves.toBe('éab');
    });
  });

  it('refuses maxBytes + 1, pauses stdin and stops listening', async () => {
    await withFakeStdin(async (stdin) => {
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { maxBytes: 4 });
      stdin.emit('data', 'éab!');
      await expect(pending).rejects.toThrow(new PayloadTooLargeError({ message: 'stdin exceeded the 4-byte limit' }));
      expect(stdin.paused).toBe(1);
      expect(stdin.listenerCount('data') + stdin.listenerCount('end') + stdin.listenerCount('error')).toBe(0);
    });
  });
});

describe('default file reader cap', () => {
  it('accepts a file of exactly maxBytes and refuses one byte more, naming the limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-cap-'));
    try {
      await writeFile(join(dir, 'ok.txt'), 'abcde');
      await writeFile(join(dir, 'big.txt'), 'abcdef');
      await expect(readPromptFromFlags({ flags: { 'prompt-file': join(dir, 'ok.txt') } }, { maxBytes: 5 })).resolves.toBe('abcde');
      await expect(readPromptFromFlags({ flags: { 'prompt-file': join(dir, 'big.txt') } }, { maxBytes: 5 }))
        .rejects.toThrow(`file exceeded the 5-byte limit: ${join(dir, 'big.txt')}`);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('sanitizeUnknownDeep caps at their exact edge', () => {
  const nest = (levels: number): unknown => { let v: unknown = 'leaf'; for (let i = 0; i < levels; i++) v = [v]; return v; };
  const unwrap = (v: unknown, levels: number): unknown => { let out = v; for (let i = 0; i < levels; i++) out = (out as unknown[])[0]; return out; };

  it('keeps a leaf at depth 4 and replaces depth 5 with the placeholder', () => {
    expect(unwrap(sanitizeUnknownDeep({ value: nest(4) }), 4)).toBe('leaf');
    expect(unwrap(sanitizeUnknownDeep({ value: nest(5) }), 5)).toBe('[omitted: nested too deeply]');
  });

  it('keeps exactly 50 array items and 50 object keys', () => {
    expect(sanitizeUnknownDeep({ value: Array.from({ length: 51 }, (_, i) => i) })).toEqual(Array.from({ length: 50 }, (_, i) => i));
    const wide = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeUnknownDeep({ value: wide }) as object)).toEqual(Array.from({ length: 50 }, (_, i) => `k${i}`));
  });
});

describe('default body stdin reader (async iterator)', () => {
  async function withIterableStdin<T>(chunks: Array<string | Buffer>, run: (stdin: { destroyed: unknown[] }) => Promise<T>): Promise<T> {
    const fake = { destroyed: [] as unknown[], destroy(error?: unknown) { fake.destroyed.push(error); }, async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } };
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
    try { return await run(fake); } finally { Object.defineProperty(process, 'stdin', { value: original, configurable: true }); }
  }

  it('accepts exactly maxBytes across string and Buffer chunks', async () => {
    await withIterableStdin(['é', Buffer.from('ab')], async () => {
      await expect(readBodyFromFlags({ flags: { 'body-file': '-' } }, { maxBytes: 4 })).resolves.toBe('éab');
    });
  });

  it('refuses maxBytes + 1 and destroys stdin', async () => {
    await withIterableStdin(['éab', '!'], async (stdin) => {
      await expect(readBodyFromFlags({ flags: { 'body-file': '-' } }, { maxBytes: 4 }))
        .rejects.toThrow(new PayloadTooLargeError({ message: 'stdin exceeded the 4-byte limit' }));
      expect(stdin.destroyed).toEqual([undefined]);
    });
  });

  it('an abort during the read destroys stdin with the abort error and rejects', async () => {
    const controller = new AbortController();
    await withIterableStdin([], async (stdin) => {
      const original = (process.stdin as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<string> });
      Object.assign(original, { async *[Symbol.asyncIterator]() { yield 'a'; controller.abort(); yield 'b'; } });
      await expect(readBodyFromFlags({ flags: { 'body-file': '-' } }, { signal: controller.signal })).rejects.toThrow();
      expect(stdin.destroyed).toHaveLength(1);
      expect((stdin.destroyed[0] as Error).message).toBe('stdin read aborted');
    });
  });
});

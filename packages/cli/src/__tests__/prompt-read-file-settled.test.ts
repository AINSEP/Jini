/**
 * Covers `prompt.ts`'s default file reader `settled` guard: the only branch a well-behaved
 * `createReadStream` never reaches (a stream emitting a second terminal event). `node:fs` is
 * mocked only to hand each test the real `ReadStream` the reader opens, so a test can emit the
 * extra event on that real stream; every read still goes to disk through the actual implementation.
 */
import type { ReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayloadTooLargeError, readPromptFromFlags } from '../prompt.js';

const opened: { onOpen: ((stream: ReadStream) => void) | null } = { onOpen: null };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>): ReadStream => {
      const stream = actual.createReadStream(...args);
      opened.onOpen?.(stream);
      return stream;
    },
  };
});

const dirs: string[] = [];
async function fileWith(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jini-cli-prompt-settled-'));
  dirs.push(dir);
  const path = join(dir, 'in.txt');
  await writeFile(path, text, 'utf8');
  return path;
}

afterEach(async () => {
  opened.onOpen = null;
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe('prompt default file reader: settled guard', () => {
  it('keeps the resolved content when the stream emits an error after end', async () => {
    const path = await fileWith('hello');
    opened.onOpen = (stream) => {
      // Deferred a tick so the reader's own 'end' listener (registered after this hook runs) settles first.
      stream.once('end', () => { process.nextTick(() => { stream.emit('error', new Error('late error after end')); }); });
    };
    await expect(readPromptFromFlags({ flags: { 'prompt-file': path } })).resolves.toBe('hello');
  });

  it('keeps the size-limit rejection when the stream emits end after being destroyed', async () => {
    const path = await fileWith('too long');
    opened.onOpen = (stream) => {
      stream.once('close', () => { stream.emit('end'); });
    };
    const read = readPromptFromFlags({ flags: { 'prompt-file': path } }, { maxBytes: 2 });
    await expect(read).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(read).rejects.toThrow(`file exceeded the 2-byte limit: ${path}`);
  });
});

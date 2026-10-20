/**
 * Characterization pins for `prompt.ts`'s flag precedence and default bounded file reader,
 * written against the pre-refactor code so extracting the shared read-limit/stream-collection
 * helpers is proven behaviour-preserving at each byte-cap boundary.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PayloadTooLargeError, readBodyFromFlags, readPromptFromFlags } from '../prompt.js';

const dirs: string[] = [];
async function fileWith(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jini-cli-prompt-pins-'));
  dirs.push(dir);
  const path = join(dir, 'in.txt');
  await writeFile(path, text, 'utf8');
  return path;
}

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe('prompt pins: readPromptFromFlags', () => {
  it('returns null for an empty --prompt with no --prompt-file', async () => {
    await expect(readPromptFromFlags({ flags: { prompt: '' } })).resolves.toBeNull();
  });

  it('reads a default file exactly at maxBytes', async () => {
    const path = await fileWith('é!');
    await expect(readPromptFromFlags({ flags: { 'prompt-file': path } }, { maxBytes: 3 })).resolves.toBe('é!');
  });

  it('rejects a default file one byte over maxBytes, naming the limit and path', async () => {
    const path = await fileWith('é!x');
    const read = readPromptFromFlags({ flags: { 'prompt-file': path } }, { maxBytes: 3 });
    await expect(read).rejects.toBeInstanceOf(PayloadTooLargeError);
    await expect(read).rejects.toThrow(`file exceeded the 3-byte limit: ${path}`);
  });

  it('propagates the default reader ENOENT error for a missing file', async () => {
    await expect(readPromptFromFlags({ flags: { 'prompt-file': join(tmpdir(), 'jini-cli-missing-pin-file') } })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('passes the path to an injected reader and ignores maxBytes for it', async () => {
    const seen: string[] = [];
    const result = await readPromptFromFlags({ flags: { 'prompt-file': 'p.txt' } }, { maxBytes: 1, readFile: async ({ path }) => { seen.push(path); return 'way more than one byte'; } });
    expect(result).toBe('way more than one byte');
    expect(seen).toEqual(['p.txt']);
  });
});

describe('prompt pins: readBodyFromFlags', () => {
  it('reads a default file exactly at maxBytes', async () => {
    const path = await fileWith('abc');
    await expect(readBodyFromFlags({ flags: { 'body-file': path } }, { maxBytes: 3 })).resolves.toBe('abc');
  });

  it('rejects a default file one byte over maxBytes, naming the limit and path', async () => {
    const path = await fileWith('abcd');
    await expect(readBodyFromFlags({ flags: { 'body-file': path } }, { maxBytes: 3 })).rejects.toThrow(`file exceeded the 3-byte limit: ${path}`);
  });

  it('rejects a default file read whose signal is already aborted', async () => {
    const path = await fileWith('abc');
    await expect(readBodyFromFlags({ flags: { 'body-file': path } }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

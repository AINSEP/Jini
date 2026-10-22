import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MAX_PROVIDER_ERROR_BYTES, readProviderResponseText } from '../response-text.js';

describe('bounded provider response text', () => {
  it('accepts the exact byte cap and decodes UTF-8 across chunk boundaries', async () => {
    const text = 'é'.repeat(MAX_PROVIDER_ERROR_BYTES / 2);
    const bytes = Buffer.from(text);
    expect(await readProviderResponseText({ body: Readable.from([bytes.subarray(0, 1), bytes.subarray(1)]) })).toBe(text);
  });

  it('refuses cap+1 without retaining more chunks and closes the upstream iterator', async () => {
    let closed = false;
    let afterExcess = false;
    async function* upstream() {
      try {
        yield Buffer.alloc(MAX_PROVIDER_ERROR_BYTES);
        yield Buffer.from('x');
        afterExcess = true;
        yield Buffer.from('private@example.test');
      } finally { closed = true; }
    }
    await expect(readProviderResponseText({ body: upstream() })).rejects.toThrow(/^Provider response could not be read within the byte limit$/);
    expect(closed).toBe(true);
    expect(afterExcess).toBe(false);
  });

  it('counts UTF-8 string chunks as bytes and destroys a refused native stream', async () => {
    const body = Readable.from(['é'.repeat(MAX_PROVIDER_ERROR_BYTES / 2), 'é']);
    await expect(readProviderResponseText({ body })).rejects.toThrow('byte limit');
    expect(body.destroyed).toBe(true);
  });
});

it('omits upstream stream failure details', async () => {
  async function* failed() { throw new Error('private@example.test'); yield ''; }
  await expect(readProviderResponseText({ body: failed() })).rejects.toThrow(/^Provider response could not be read within the byte limit$/);
});

describe('readProviderResponseText limit validation', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects an unusable maxBytes of %s before reading the body', async (maxBytes) => {
    let read = false;
    async function* body() { read = true; yield 'x'; }
    await expect(readProviderResponseText({ body: body() }, { maxBytes })).rejects.toThrow(new RangeError('Invalid provider response limit'));
    expect(read).toBe(false);
  });

  it('accepts the smallest valid limit of one byte', async () => {
    expect(await readProviderResponseText({ body: Readable.from(['x']) }, { maxBytes: 1 })).toBe('x');
  });
});

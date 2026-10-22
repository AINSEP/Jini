import { expect, it } from 'vitest';
import { getJsonFromDaemon } from '../http.js';
import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it.each(['unknown', 'size', 'body', 'null'])('emits a structured failure for %s responses using injected ports', async failure => {
  const output: string[] = [];
  const exits: number[] = [];
  const stop = new Error('exit');
  const fetchImpl = (async () => {
    if (failure === 'size') return new Response('12345');
    if (failure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('body failed')); } }));
    return new Response(JSON.stringify(failure === 'null' ? null : { error: { code: 'unmapped', message: 'denied' } }), { status: 403 });
  }) as typeof fetch;
  await expect(getJsonFromDaemon({ base: 'http://localhost', route: '/api/runs' }, {
    fetchImpl, maxResponseBytes: failure === 'size' ? 1 : 4096,
    write: ({ text }) => { output.push(text); }, exit: ({ code }) => { exits.push(code); throw stop; },
  })).rejects.toBe(stop);
  expect(exits).toEqual([1]);
  expect(output).toHaveLength(1);
  expect(JSON.parse(output[0]!).error).toMatchObject({ code: expect.any(String), message: expect.any(String), data: expect.any(Object) });
});

it.each([0, 1, 3, 20, 500])('includes the truncation marker within a %i-character cap', maxLength => {
  const result = sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength });
  expect(result.length).toBeLessThanOrEqual(maxLength);
  if (maxLength > 0) expect(result).toContain('…');
  if (maxLength >= 20) expect(result).toContain('truncated');
});

it.each([[-1, 0], [1.5, 1], [Number.NaN, 500], [Number.POSITIVE_INFINITY, 500]])('normalizes a %s-character cap to %i', (maxLength, expectedLength) => {
  expect(sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength }).length).toBe(expectedLength);
});



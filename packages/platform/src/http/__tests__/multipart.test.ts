import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseFormMultipart } from '../multipart.adapter.js';

const contentType = 'multipart/form-data; boundary=controls';
type Part = { name: string; value: string; filename?: string };
const encode = (parts: readonly Part[]): Uint8Array => new TextEncoder().encode(parts.map(part =>
  `--controls\r\nContent-Disposition: form-data; name="${part.name}"${part.filename === undefined ? '' : `; filename="${part.filename}"`}\r\n\r\n${part.value}\r\n`,
).join('') + '--controls--\r\n');

test('submitted controls keep repeated values in order and treat prototype keys as data', async () => {
  const bytes = encode([{ name: '__proto__', value: 'safe' }, { name: 'choice', value: 'a' },
    { name: 'choice', value: 'b' }, { name: 'choice', value: 'c' }]);
  const body = await parseFormMultipart({ bytes, contentType });
  assert.equal(Object.getPrototypeOf(body), null);
  assert.equal(body.__proto__, 'safe');
  assert.deepEqual(body.choice, ['a', 'b', 'c']);
});

test('empty file pickers are omitted while unnamed nonempty and named empty uploads survive', async () => {
  const body = await parseFormMultipart({ bytes: encode([{ name: 'none', value: '', filename: '' },
    { name: 'unnamed', value: 'x', filename: '' }, { name: 'named', value: '', filename: 'empty.txt' }]), contentType });
  assert.equal(Object.hasOwn(body, 'none'), false);
  assert.deepEqual(body.unnamed, { filename: '', contentType: 'text/plain', bytes: Uint8Array.of(120) });
  assert.deepEqual(body.named, { filename: 'empty.txt', contentType: 'text/plain', bytes: new Uint8Array() });
});

test('upload limits use the caller configuration and include the exact byte and control boundary', async () => {
  const bytes = encode([{ name: 'choice', value: 'a' }, { name: 'choice', value: 'b' }]);
  const body = await parseFormMultipart({ bytes, contentType }, { maxBytes: bytes.byteLength, maxControls: 2 });
  assert.deepEqual(body.choice, ['a', 'b']);
  await assert.rejects(parseFormMultipart({ bytes, contentType }, { maxBytes: bytes.byteLength - 1 }), RangeError);
  await assert.rejects(parseFormMultipart({ bytes, contentType }, { maxControls: 1 }), { name: 'RangeError', message: 'too many form controls' });
});

test('malformed uploads and invalid configured limits fail before returning any controls', async () => {
  const bytes = encode([{ name: 'topic', value: 'a' }]);
  await assert.rejects(parseFormMultipart({ bytes, contentType: 'multipart/form-data' }), TypeError);
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(parseFormMultipart({ bytes, contentType }, { maxBytes }), RangeError);
  }
  for (const maxControls of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(parseFormMultipart({ bytes, contentType }, { maxControls }), RangeError);
  }
});

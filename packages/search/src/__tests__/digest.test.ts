import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { sha256Hex } from '../digest.js';

test('sha256Hex matches the FIPS 180-4 vectors', () => {
  expect(sha256Hex({ text: '' })).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex({ text: 'abc' })).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256Hex({ text: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' })).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256Hex agrees with node:crypto across block boundaries and on multi-byte UTF-8', () => {
  for (const text of ['x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(1000), 'site ü 日本 😀', '["inst","site-a","meilisearch"]']) {
    expect(sha256Hex({ text })).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  }
});

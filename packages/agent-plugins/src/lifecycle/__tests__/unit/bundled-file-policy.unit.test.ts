import { expect, test } from 'vitest';
import { classifyBundledPluginFile } from '../../bundled-file-policy.js';

const bytes = Buffer.from('Token = the access-policy token');
const readFile = async () => bytes;

test.each(['plugin.json', 'skills/sample/SKILL.md', 'src/fixtures-helper.ts', 'test.ts', '__tests__/nested/example.ts', 'src/example.test.ts', 'fixtures/nested/example.json'])('skips scanning only identical installed bytes: %s', async relativePath => {
  expect(await classifyBundledPluginFile({ pluginId: 'sample', relativePath, bytes, readFile })).toBe('skip');
  expect(await classifyBundledPluginFile({ pluginId: 'sample', relativePath, bytes: Buffer.from('password=changed-secret'), readFile })).toBe('scan');
});

test('missing, unreadable and same-length changed copies always scan', async () => {
  for (const readFile of [async () => null, async () => { throw new Error('unreadable'); }, async () => Buffer.alloc(bytes.length)]) {
    expect(await classifyBundledPluginFile({ pluginId: 'sample', relativePath: '__tests__/example.ts', bytes, readFile })).toBe('scan');
  }
});

test.each(['../secret', '/secret', 'src/../../secret', 'src\\secret', 'src//secret', './secret', 'C:/secret'])('unsafe paths never reach the reader: %s', async relativePath => {
  let reads = 0;
  expect(await classifyBundledPluginFile({ pluginId: 'sample', relativePath, bytes, readFile: async () => { reads++; return bytes; } })).toBe('scan');
  expect(reads).toBe(0);
});

test('comparison is per file and binary exact, with no cached exemption for later bytes', async () => {
  const readFile = async () => Uint8Array.from([0, 255, 128]);
  const input = { pluginId: 'sample', relativePath: 'fixtures/binary', readFile };
  expect(await classifyBundledPluginFile({ ...input, bytes: Uint8Array.from([0, 255, 128]) })).toBe('skip');
  expect(await classifyBundledPluginFile({ ...input, bytes: Uint8Array.from([0, 255, 129]) })).toBe('scan');
});

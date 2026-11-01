import { expect, it } from 'vitest';
import { parseNpmPackJson } from '../lib/npm-pack-json.js';

const entry = { name: '@jini-ai/plugin-x', version: '0.6.16', filename: 'jini-ai-plugin-x-0.6.16.tgz', files: [{ path: 'package.json' }] };

it('reads the npm 11 shape: an array of entries', () => {
  expect(parseNpmPackJson({ stdout: JSON.stringify([entry]) })).toEqual(entry);
});

it('reads the npm 12 shape: an object keyed by package name', () => {
  expect(parseNpmPackJson({ stdout: JSON.stringify({ [entry.name]: entry }) })).toEqual(entry);
});

it('rejects output that does not describe exactly one packed package', () => {
  expect(() => parseNpmPackJson({ stdout: '[]' })).toThrow(/exactly one/);
  expect(() => parseNpmPackJson({ stdout: JSON.stringify({ a: entry, b: entry }) })).toThrow(/exactly one/);
  expect(() => parseNpmPackJson({ stdout: JSON.stringify([{ name: 'x' }]) })).toThrow(/filename/);
  expect(() => parseNpmPackJson({ stdout: 'null' })).toThrow(/exactly one/);
});

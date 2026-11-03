import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseNpmPackJson } from '../lib/npm-pack-json.js';

const entry = { name: '@jini-ai/provider-plugins', version: '0.6.16', filename: 'jini-ai-provider-plugins-0.6.16.tgz', files: [{ path: 'package.json' }] };

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

// Release gates must not silently switch npm's output contract on the next major.
it('pins npm 11 for trusted publishing in every workflow that installs npm', () => {
  const workflows = new URL('../../.github/workflows/', import.meta.url);
  const installs = readdirSync(workflows).flatMap(name =>
    [...readFileSync(new URL(name, workflows), 'utf8').matchAll(/npm install -g npm@([^\s]+)/g)].map(match => match[1]),
  );
  expect(installs.length).toBeGreaterThan(0);
  expect(installs).toEqual(installs.map(() => '11'));
});

it('keeps the plain-Node packed fixture and its source map in sync with TypeScript', () => {
  const source = readFileSync(new URL('../testing/packed-fixture.ts', import.meta.url), 'utf8');
  const { outputText, sourceMapText } = ts.transpileModule(source, {
    fileName: 'packed-fixture.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true },
  });
  expect(readFileSync(new URL('../testing/packed-fixture.js.map', import.meta.url), 'utf8')).toBe(sourceMapText);
  expect(readFileSync(new URL('../testing/packed-fixture.js', import.meta.url), 'utf8')).toBe(outputText);
});

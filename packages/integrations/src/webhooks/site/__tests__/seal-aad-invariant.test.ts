import { expect, it } from 'vitest';
import ts from 'typescript';
import { findSealCallsInSource } from '../seal-aad-invariant.js';

it('an exemption matches one exact path and collapsed call only', () => {
  const isExempt = ({ displayPath, text }: { displayPath: string; text: string }) => displayPath === 'source.ts' && text === 'port.seal({ id: pluginId }, {})';
  expect(findSealCallsInSource({ sourceText: 'port.seal({ id: pluginId },\n{})', displayPath: 'source.ts', ast: ts, isExempt })).toEqual([]);
  const differentPath = findSealCallsInSource({ sourceText: 'port.seal({ id: pluginId }, {})', displayPath: 'different.ts', ast: ts, isExempt });
  expect(differentPath).toEqual([{ file: 'different.ts', line: 1, text: 'port.seal({ id: pluginId }, {})', reason: 'unresolved-argument-shape' }]);
  expect(findSealCallsInSource({ sourceText: 'port.seal({ id: other }, {})', displayPath: 'source.ts', ast: ts, isExempt }).map(item => item.reason)).toEqual(['unresolved-argument-shape']);
});

it('zero and multiple seal arguments fail closed', () => {
  const result = findSealCallsInSource({ sourceText: 'sealer.seal();\nsealer.seal({ aad }, {});', displayPath: 'input.ts', ast: ts, isExempt: () => false });
  expect(result.map(({ line, reason }) => ({ line, reason }))).toEqual([
    { line: 1, reason: 'unresolved-argument-shape' }, { line: 2, reason: 'unresolved-argument-shape' },
  ]);
});

it('literal undefined is distinct from shorthand aad', () => {
  const result = findSealCallsInSource({ sourceText: 'sealer.seal({ aad: undefined });\nsealer.seal({ aad });\nsealer.seal({ ...input });', displayPath: 'input.tsx', ast: ts, isExempt: () => false });
  expect(result.map(({ line, reason }) => ({ line, reason }))).toEqual([
    { line: 1, reason: 'aad-literally-undefined' }, { line: 3, reason: 'unresolved-argument-shape' },
  ]);
});

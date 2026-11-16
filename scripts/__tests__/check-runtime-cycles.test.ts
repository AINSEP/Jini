import { expect, it } from 'vitest';
import { checkRuntimeCycles } from '../check-runtime-cycles.js';
import { runRuntimeCycleSelfTest } from '../lib/runtime-cycles-self-test.js';
import { REPO_ROOT } from '../lib/walk-imports.js';

it('flags value cycles and kept-import cycles, ignores type-only and test loops, and keeps the debt list shrink-only', () => {
  expect(runRuntimeCycleSelfTest()).toEqual([]);
}, 120_000);

it('finds no runtime module cycle in the real packages beyond the recorded debt', () => {
  expect(checkRuntimeCycles({ repoRoot: REPO_ROOT })).toEqual([]);
}, 240_000);

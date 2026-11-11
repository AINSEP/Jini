/**
 * @file Edges of the bundled-digest ledger: hostile ledger shapes read as empty instead of throwing
 * (null file, null/array plugins, null entries), the digest and plugin-id grammars at their anchors,
 * this boot's verdict when an id is seeded twice (same digest kept; different digests drop the PRIOR
 * entry too), invalid seeded rows skipped individually, and narrowing only when the recorded digest
 * is one of the installed ones. Closes Stryker run-2 survivors at bundled-digests.ts:97-99, 144-146,
 * 185, 207-208, 320, 331. Lines 118/125/234 (catch bodies) are equivalent: an emptied catch falls
 * through to a parse/shape check that returns the same empty answer.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forceRemove } from '../fixtures/force-remove.js';
import { normalizeBundledDigests, preferBundledAgentPluginDigests, readBundledAgentPluginDigests, recordBundledAgentPluginDigests } from '../test-support.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await forceRemove(root); });
async function workspace() { const root = await mkdtemp(path.join(tmpdir(), 'jini-bundled-edges-')); roots.push(root); return root; }
const ledgerPath = (root: string) => path.join(root, 'bundled-digests.json');

describe('normalizeBundledDigests', () => {
  test.each<[string, unknown]>([
    ['null', null], ['an array', [{ schemaVersion: 1 }]], ['a string', 'x'], ['wrong version', { schemaVersion: 2, plugins: { p: { archiveDigest: A } } }],
    ['null plugins', { schemaVersion: 1, plugins: null }], ['array plugins', { schemaVersion: 1, plugins: [{ archiveDigest: A }] }],
  ])('%s is the empty ledger, never a throw', (_name, value) => {
    expect(normalizeBundledDigests(value).size).toBe(0);
  });

  test('bad entries are skipped one by one, good ones kept', () => {
    const ledger = normalizeBundledDigests({ schemaVersion: 1, plugins: {
      good: { archiveDigest: A }, 'also.good-1': { archiveDigest: B },
      nullEntry: null, arrayEntry: [A], stringEntry: A, numberDigest: { archiveDigest: 7 },
      long: { archiveDigest: `${A}0` }, prefixed: { archiveDigest: `0${A}` }, upper: { archiveDigest: 'A'.repeat(64) },
      'bad_': { archiveDigest: A }, '-bad': { archiveDigest: A }, 'Bad': { archiveDigest: A },
    } });
    expect([...ledger]).toEqual([['good', A], ['also.good-1', B]]);
  });

  test('a ledger FILE holding null or junk reads as empty', async () => {
    const root = await workspace();
    await writeFile(ledgerPath(root), 'null');
    expect((await readBundledAgentPluginDigests(root)).size).toBe(0);
    await writeFile(ledgerPath(root), '{"schemaVersion":1,"plugins":{"p":null}}');
    expect((await readBundledAgentPluginDigests(root)).size).toBe(0);
  });
});

describe('recordBundledAgentPluginDigests', () => {
  const now = () => new Date(0);
  const read = async (root: string) => [...await readBundledAgentPluginDigests(root)];

  test('an id seeded twice under the SAME digest is recorded once', async () => {
    const root = await workspace();
    await recordBundledAgentPluginDigests({ workspaceRoot: root, now, seeded: [{ pluginId: 'p', archiveDigest: A }, { pluginId: 'p', archiveDigest: A }] });
    expect(await read(root)).toEqual([['p', A]]);
  });

  test('an id seeded twice under DIFFERENT digests drops its prior entry too; others survive', async () => {
    const root = await workspace();
    await recordBundledAgentPluginDigests({ workspaceRoot: root, now, seeded: [{ pluginId: 'p', archiveDigest: A }, { pluginId: 'q', archiveDigest: A }] });
    await recordBundledAgentPluginDigests({ workspaceRoot: root, now, seeded: [{ pluginId: 'p', archiveDigest: B }, { pluginId: 'p', archiveDigest: C }] });
    expect(await read(root)).toEqual([['q', A]]);
  });

  test('an invalid id or an invalid digest is skipped on its own', async () => {
    const root = await workspace();
    await recordBundledAgentPluginDigests({ workspaceRoot: root, now, seeded: [
      { pluginId: 'Bad Id', archiveDigest: A }, { pluginId: 'ok', archiveDigest: 'not-a-digest' }, { pluginId: 'fine', archiveDigest: B },
    ] });
    expect(await read(root)).toEqual([['fine', B]]);
    expect(JSON.parse(await readFile(ledgerPath(root), 'utf8'))).toEqual({ schemaVersion: 1, plugins: { fine: { archiveDigest: B, seededAt: '1970-01-01T00:00:00.000Z' } } });
  });
});

describe('preferBundledAgentPluginDigests', () => {
  const installed = [{ pluginId: 'p', archiveDigest: A }, { pluginId: 'p', archiveDigest: B }, { pluginId: 'q', archiveDigest: C }];

  test('narrows an id to its recorded digest only when that digest is installed', () => {
    expect(preferBundledAgentPluginDigests(installed, new Map([['p', B]]))).toEqual([installed[1], installed[2]]);
    expect(preferBundledAgentPluginDigests(installed, new Map([['p', C]]))).toEqual(installed);
    expect(preferBundledAgentPluginDigests(installed, new Map([['other', A]]))).toEqual(installed);
  });

  test('a single installed digest is never narrowed, even to a different recorded one', () => {
    expect(preferBundledAgentPluginDigests(installed, new Map([['q', A]]))).toEqual(installed);
  });
});

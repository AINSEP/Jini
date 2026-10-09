import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCompatiblePeerRanges } from '../lib/peer-range-compatibility.js';
import { checkPeerRanges } from '../check-peer-ranges.js';

const cms053 = { name: '@jini-ai/cms', version: '0.5.3', peerDependencies: { parse5: '^7.3.0' },
  peerDependenciesMeta: { parse5: { optional: true } } };
const ui045 = { name: '@jini-ai/ui', version: '0.4.5', peerDependencies: { parse5: '^8.0.1' },
  peerDependenciesMeta: { parse5: { optional: true } } };
const conflict = 'Incompatible public package peers:\nparse5: @jini-ai/cms (^7.3.0) and @jini-ai/ui (^8.0.1) have no common version';

describe('public workspace peer compatibility', () => {
  it('rejects the optional parse5 ranges shipped by cms@0.5.3 and ui@0.4.5', () => {
    expect(() => assertCompatiblePeerRanges({ packages: [cms053, ui045] })).toThrow(conflict);
  });

  it('also rejects disjoint required peers', () => {
    expect(() => assertCompatiblePeerRanges({ packages: [
      { name: cms053.name, peerDependencies: cms053.peerDependencies },
      { name: ui045.name, peerDependencies: ui045.peerDependencies },
    ] })).toThrow(conflict);
  });

  it.each(['^7.3.0', '^7.3.0 || ^8.0.1', '>=7.3.0 <9.0.0'])('accepts overlapping ranges: %s', range => {
    expect(() => assertCompatiblePeerRanges({ packages: [cms053, { ...ui045, peerDependencies: { parse5: range } }] })).not.toThrow();
  });

  it('ignores private packages and compares only declarations of the same peer', () => {
    expect(() => assertCompatiblePeerRanges({ packages: [cms053, { ...ui045, private: true },
      { name: '@jini-ai/other', peerDependencies: { unrelated: '^8.0.1' } },
    ] })).not.toThrow();
  });

  it('compares all package pairs rather than only adjacent declarations', () => {
    expect(() => assertCompatiblePeerRanges({ packages: [cms053,
      { name: '@jini-ai/bridge', peerDependencies: { parse5: '^7.3.0 || ^8.0.1' } }, ui045,
    ] })).toThrow(conflict);
  });

  it('fails closed on an invalid peer range', () => {
    expect(() => assertCompatiblePeerRanges({ packages: [
      { name: '@jini-ai/fixture', peerDependencies: { parse5: 'not-a-range' } },
    ] })).toThrow('@jini-ai/fixture: invalid peer range for parse5: not-a-range');
  });

  it('wires the workspace check to discovered public manifests, including nested members', () => {
    const root = mkdtempSync(join(tmpdir(), 'jini-peer-ranges-'));
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - packages/cms/forms\n');
      for (const [directory, manifest] of [
        ['packages/cms', cms053], ['packages/ui', ui045],
        ['packages/cms/forms', { name: '@jini-ai/cms-forms', private: true, peerDependencies: { parse5: '^6.0.0' } }],
      ] as const) {
        mkdirSync(join(root, directory), { recursive: true });
        writeFileSync(join(root, directory, 'package.json'), JSON.stringify(manifest));
      }
      expect(() => checkPeerRanges({ repoRoot: root })).toThrow(conflict);
      writeFileSync(join(root, 'packages/ui/package.json'), JSON.stringify({ ...ui045, peerDependencies: { parse5: '^7.3.0' } }));
      expect(() => checkPeerRanges({ repoRoot: root })).not.toThrow();
      writeFileSync(join(root, 'packages/cms/forms/package.json'), JSON.stringify({
        name: '@jini-ai/cms-forms', peerDependencies: { parse5: '^8.0.1' },
      }));
      expect(() => checkPeerRanges({ repoRoot: root })).toThrow(
        'parse5: @jini-ai/cms (^7.3.0) and @jini-ai/cms-forms (^8.0.1) have no common version');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';

test('engine neutrality rejects product identity in JSON plugin manifests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-neutrality-json-'));
  try {
    const directory = join(root, 'packages', 'fixture');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@jini-ai/fixture', jini: { domain: 'tooling', kind: 'fixture', runtime: 'universal' } }));
    writeFileSync(join(directory, 'jini.plugin.json'), JSON.stringify({ name: 'Open Design', url: 'https://opendesign.app' }));
    writeFileSync(join(directory, 'plugin.json'), JSON.stringify({ name: 'neutral', extensions: { tovu: { id: 'publisher/legacy' } } }));
    const violations = (await checkEngineBoundaries({ repoRoot: root })).filter(item => item.rule === 'R5-neutrality');
    expect(violations).toEqual([
      { rule: 'R5-neutrality', file: 'packages/fixture/jini.plugin.json', reason: 'product-identity string "Open Design"' },
      { rule: 'R5-neutrality', file: 'packages/fixture/jini.plugin.json', reason: 'product-identity string "opendesign.app"' },
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

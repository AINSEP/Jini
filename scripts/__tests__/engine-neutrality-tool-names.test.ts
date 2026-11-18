import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';

test('engine neutrality rejects a host tool name in package source but not in tests or comments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-neutrality-tool-names-'));
  try {
    const directory = join(root, 'packages', 'fixture');
    mkdirSync(join(directory, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@jini-ai/fixture', jini: { domain: 'tooling', kind: 'fixture', runtime: 'universal' } }));
    writeFileSync(join(directory, 'src', 'leak.ts'), "export const id = 'content_read';\n");
    writeFileSync(join(directory, 'src', 'note.ts'), '// content_read is a host tool name: this comment is provenance, not code.\nexport const ok = 1;\n');
    writeFileSync(join(directory, 'src', '__tests__', 'leak.test.ts'), "export const id = 'content_read';\n");
    writeFileSync(join(directory, 'src', 'unit.test.ts'), "export const id = 'content_read';\n");
    const violations = (await checkEngineBoundaries({ repoRoot: root })).filter(item => item.rule === 'R5-neutrality');
    expect(violations).toEqual([
      { rule: 'R5-neutrality', file: 'packages/fixture/src/leak.ts', reason: 'host tool name "content_read"' },
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

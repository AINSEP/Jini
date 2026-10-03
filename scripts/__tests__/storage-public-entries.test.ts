/** Accepted storage extraction: public entries remain usable; private reaches remain forbidden. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';

const entries = [
  '@jini-ai/chat/core', '@jini-ai/chat/store', '@jini-ai/chat/store/sqlite',
  '@jini-ai/chat/store/pglite', '@jini-ai/chat/store/postgres',
  '@jini-ai/chat/store/legacy', '@jini-ai/chat/store/legacy/sqlite',
  '@jini-ai/daemon/store/event-log/sqlite', '@jini-ai/daemon/store/agent-sessions',
  '@jini-ai/daemon/store/agent-sessions/sqlite', '@jini-ai/daemon/store/agent-sessions/pglite',
  '@jini-ai/daemon/store/agent-sessions/postgres',
  '@jini-ai/registry/tool-catalog', '@jini-ai/registry/tool-catalog/sqlite',
  '@jini-ai/server/storage', '@jini-ai/server/storage/legacy/sqlite',
  '@jini-ai/server/store/projects/sqlite',
];

async function violations(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'storage-boundary-'));
  const pkg = join(root, 'packages/consumer');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@jini-ai/consumer', jini: { domain: 'server', kind: 'runtime', runtime: 'node' } }));
  writeFileSync(join(pkg, 'src/index.ts'), source);
  try { return (await checkEngineBoundaries({ repoRoot: root })).filter(v => v.rule === 'R2-deep-path'); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

describe('storage public import gates', () => {
  it.each(entries)('accepts the approved entry %s', async entry => {
    expect(await violations(`export * from '${entry}';`)).toEqual([]);
  });
  it.each([
    '@jini-ai/chat/store/sql/store', '@jini-ai/daemon/store/agent-sessions/sql',
    '@jini-ai/registry/tool-catalog/private', '@jini-ai/server/storage/backend-config',
    '@jini-ai/chat/src/store/index', '@jini-ai/db/kernel/kernel-core',
  ])('rejects private entry %s via imports, re-exports and dynamic imports', async entry => {
    for (const source of [`import '${entry}';`, `export * from '${entry}';`, `const adapter = import('${entry}');`]) {
      expect(await violations(source)).toHaveLength(1);
    }
  });
});

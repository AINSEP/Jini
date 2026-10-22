// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const extensions = ['js', 'd.ts', 'js.map', 'd.ts.map'];
const cases = [
  {
    name: 'core',
    manifest: new URL('../../../../../../core/package.json', import.meta.url),
    artifacts: ['dist/compose.typecheck', 'dist/args-convention.typecheck', 'dist/nested/proof.typecheck'],
  },
  {
    name: 'server',
    manifest: new URL('../../../../../../server/package.json', import.meta.url),
    artifacts: ['dist/create-local-node-daemon.typecheck', 'dist/nested/proof.typecheck'],
  },
  {
    name: 'ui',
    manifest: new URL('../../../../../../ui/package.json', import.meta.url),
    artifacts: ['dist/features/lexical-rich-text-editor/react/test-support/lexical-harness'],
  },
];

describe('published test-code exclusions', () => {
  for (const { name, manifest, artifacts } of cases) {
    // REGRESSION: fails if the new typecheck (core/server) or test-support (ui) files exclusion is removed.
    it(`${name} omits test helpers while retaining runtime files`, () => {
      const fixture = mkdtempSync(join(tmpdir(), 'jini-publish-hygiene-'));
      try {
        // Pack an isolated emitted-output fixture with the real manifest: this exercises
        // npm's file selection without builds, workspace resolution, or lifecycle scripts.
        writeFileSync(join(fixture, 'package.json'), readFileSync(manifest));
        const testFiles = artifacts.flatMap((artifact) => extensions.map((extension) => `${artifact}.${extension}`));
        const runtimeFiles = ['dist/index.js', 'dist/index.d.ts', 'README.md', 'CHANGELOG.md', 'LICENSE'];
        for (const file of [...testFiles, ...runtimeFiles]) {
          mkdirSync(dirname(join(fixture, file)), { recursive: true });
          writeFileSync(join(fixture, file), 'fixture\n');
        }

        const output = execFileSync('npm', [
          'pack', '--dry-run', '--json', '--ignore-scripts', '--offline', '--cache', join(fixture, 'npm-cache'),
        ], { cwd: fixture, encoding: 'utf8', timeout: 10_000 });
        const packs: Array<{ files: Array<{ path: string }> }> = JSON.parse(output);
        expect(packs).toHaveLength(1);
        const packedPaths = packs.flatMap((pack) => pack.files.map((file) => file.path));
        expect(packedPaths).toEqual(expect.arrayContaining(['package.json', ...runtimeFiles]));
        for (const file of testFiles) expect(packedPaths).not.toContain(file);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }, 15_000);
  }
});

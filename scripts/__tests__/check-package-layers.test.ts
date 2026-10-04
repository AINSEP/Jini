import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageLayers } from '../check-package-layers.js';

describe('user-management optional admin integration layer exception', () => {
  let root: string;

  function write(required: { file: string; content: string }, _optional: Record<string, never> = {}): void {
    const path = join(root, required.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, required.content);
  }

  function userManifest(
    required: { optional: boolean },
    optional: { dependencies?: Record<string, string> } = {},
  ): void {
    write({ file: 'packages/user-management/package.json', content: JSON.stringify({
      name: '@jini-ai/user-management',
      dependencies: optional.dependencies,
      peerDependencies: { '@jini-ai/admin': '*', '@jini-ai/ui': '*' },
      peerDependenciesMeta: {
        '@jini-ai/admin': { optional: required.optional },
        '@jini-ai/ui': { optional: true },
      },
    }) });
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jini-admin-layer-test-'));
    userManifest({ optional: true });
    write({ file: 'packages/admin/package.json', content: JSON.stringify({
      name: '@jini-ai/admin', exports: {
        '.': './dist/core/index.js',
        './core/module': { types: './dist/core/module/index.d.ts', import: './dist/core/module/index.js' },
        './react/shell': './dist/react/shell/index.js',
        './contracts/*': './dist/contracts/*.js',
        './contracts/private': null,
        './disabled': null,
      },
    }) });
    write({ file: 'packages/ui/package.json', content: JSON.stringify({ name: '@jini-ai/ui' }) });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // Regression: roles.module and its nested React hooks use the public module API.
  it.each([
    ['src/admin/roles.module.ts', "import type { Module } from '@jini-ai/admin/core/module';"],
    ['src/admin/react/hooks/binding.ts', "export { Module } from '@jini-ai/admin/core/module';"],
    ['src/admin/root.ts', "import { Module } from '@jini-ai/admin';"],
    ['src/admin/dynamic.ts', "const shell = import('@jini-ai/admin/react/shell');"],
    ['src/admin/require.cts', "const shell = require('@jini-ai/admin/react/shell');"],
    ['src/admin/contract.ts', "import type { Contract } from '@jini-ai/admin/contracts/entities';"],
  ])('allows public optional admin entry in %s', (file, content) => {
    write({ file: `packages/user-management/${file}`, content });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([]);
  });

  it.each(['src/server/service.ts', 'src/core/model.ts', 'src/index.ts', 'src/administer/service.ts'])
    ('keeps public admin imports blocked outside the admin subtree: %s', file => {
      write({ file: `packages/user-management/${file}`, content: "import { Module } from '@jini-ai/admin/core/module';" });
      expect(checkPackageLayers({ repoRoot: root })).toEqual([{
        rule: 'L1-layer-edge', file: `packages/user-management/${file}`,
        reason: 'user-management → @jini-ai/admin/core/module: L4 cannot depend on L5',
      }]);
    });

  it.each([
    '@jini-ai/admin/src/core/module', '@jini-ai/admin/dist/core/module',
    '@jini-ai/admin/core/private', '@jini-ai/admin/disabled',
    '@jini-ai/admin/contracts/private', '@jini-ai/admin/contracts/../private',
  ])('keeps private or disabled admin path blocked: %s', spec => {
    write({ file: 'packages/user-management/src/admin/private.ts', content: `import { X } from '${spec}';` });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([{
      rule: 'L1-layer-edge', file: 'packages/user-management/src/admin/private.ts',
      reason: `user-management → ${spec}: L4 cannot depend on L5`,
    }]);
  });

  it('does not extend the admin subtree exception to another L5 peer', () => {
    write({ file: 'packages/user-management/src/admin/ui.ts', content: "import { X } from '@jini-ai/ui';" });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([{
      rule: 'L1-layer-edge', file: 'packages/user-management/src/admin/ui.ts',
      reason: 'user-management → @jini-ai/ui: L4 cannot depend on L5',
    }]);
  });

  it('requires the admin peer to be optional', () => {
    userManifest({ optional: false });
    write({ file: 'packages/user-management/src/admin/roles.ts', content: "import { X } from '@jini-ai/admin/core/module';" });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([
      { rule: 'L1-layer-edge', file: 'packages/user-management/package.json', reason: 'user-management → @jini-ai/admin: L4 cannot depend on L5' },
      { rule: 'L1-layer-edge', file: 'packages/user-management/src/admin/roles.ts', reason: 'user-management → @jini-ai/admin/core/module: L4 cannot depend on L5' },
    ]);
  });

  it('still rejects a required dependency even alongside the optional peer', () => {
    userManifest({ optional: true }, { dependencies: { '@jini-ai/admin': '*' } });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([{
      rule: 'L1-layer-edge', file: 'packages/user-management/package.json',
      reason: 'user-management → @jini-ai/admin: L4 cannot depend on L5',
    }]);
  });

  it('preserves the existing optional React integration exception', () => {
    write({ file: 'packages/user-management/src/react/roles.ts', content: "import { X } from '@jini-ai/admin/core/module'; import { Y } from '@jini-ai/ui';" });
    expect(checkPackageLayers({ repoRoot: root })).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleResolutionKind, preProcessFile, resolveModuleName, sys } from 'typescript';
import { describe, expect, it } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Follow relative imports and re-exports, including inline import types, without loading code.
 * TypeScript's scanner ignores comments and its resolver follows extensionless and build-free
 * JavaScript imports as well as TypeScript sources; the active path
 * detects cycles while the completed set avoids revisiting shared dependencies.
 * Time is O(source bytes + V + E); graph traversal space is O(V). */
function findCycle({ entry, forbidden = [] }: { entry: string; forbidden?: readonly string[] }): string[] {
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const active: string[] = [];

  function visit(file: string): string[] {
    if (forbidden.includes(file)) throw new Error('Read side imports a mutation lifecycle');
    if (visiting.has(file)) return [...active.slice(active.indexOf(file)), file];
    if (completed.has(file)) return [];
    visiting.add(file);
    active.push(file);
    const { importedFiles } = preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const { resolvedModule } = resolveModuleName(fileName, file, {
        moduleResolution: ModuleResolutionKind.Bundler, allowJs: true,
      }, sys);
      if (!resolvedModule) throw new Error(`Cannot resolve '${fileName}' from '${file}'`);
      const dependencies = [resolvedModule.resolvedFileName];
      // A build-free declaration must not hide cycles in its paired JavaScript implementation.
      const implementation = resolvedModule.resolvedFileName.replace(/\.d\.ts$/, '.js');
      if (implementation !== resolvedModule.resolvedFileName && sys.fileExists(implementation)) {
        dependencies.push(implementation);
      }
      for (const dependency of dependencies) {
        const cycle = visit(dependency);
        if (cycle.length > 0) return cycle;
      }
    }
    active.pop();
    visiting.delete(file);
    completed.add(file);
    return [];
  }

  return visit(entry);
}

describe('shared contracts have no implementation import cycles', () => {
  // REGRESSION: fails if ports.ts imports AgentPluginDeliveryMode from './resolve-agent-plugin-refs.js' again.
  it('keeps lifecycle ports acyclic', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'agent-plugins/src/lifecycle/ports.ts') })).toEqual([]);
  });

  // REGRESSION: fails if ClientRegistrationCache.get uses import('./registration.js').RegisteredOAuthClient again.
  it('keeps OAuth ports acyclic', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'oauth/src/ports.ts') })).toEqual([]);
  });

  // REGRESSION: fails if diagnostics ports.ts imports MachineInfo from './manifest.js' again.
  it('keeps diagnostics ports acyclic', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'diagnostics/src/ports.ts') })).toEqual([]);
  });

  // MOVE: Both transport and argument contracts must stay below their consuming server/dispatcher.
  it('keeps the MCP server and its SDK adapter acyclic', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'mcp/src/server/tool-server.ts') })).toEqual([]);
  });
});

describe('installed package read ownership', () => {
  for (const filename of ['installed-package-index.ts', 'resolve-agent-plugin-refs.ts']) {
    it(`${filename} reaches no installation or removal module`, () => {
      const root = resolve(packagesRoot, 'agent-plugins/src/lifecycle');
      expect(findCycle({ entry: resolve(root, filename), forbidden: [
        resolve(root, 'install.ts'), resolve(root, 'uninstall.ts'),
      ] })).toEqual([]);
    });
  }
  it('install.ts stays acyclic while reusing uninstall removal', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'agent-plugins/src/lifecycle/install.ts') })).toEqual([]);
  });
});

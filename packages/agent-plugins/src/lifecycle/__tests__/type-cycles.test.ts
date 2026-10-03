import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preProcessFile } from 'typescript';
import { describe, expect, it } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Follow relative imports and re-exports, including inline import types, without loading code.
 * TypeScript's scanner ignores comments and supplies the dependency edges; the active path
 * detects cycles while the completed set avoids revisiting shared dependencies.
 * Time is O(source bytes + V + E); graph traversal space is O(V). */
function findCycle({ entry }: { entry: string }): string[] {
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const active: string[] = [];

  function visit(file: string): string[] {
    if (visiting.has(file)) return [...active.slice(active.indexOf(file)), file];
    if (completed.has(file)) return [];
    visiting.add(file);
    active.push(file);
    const { importedFiles } = preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const dependency = resolve(dirname(file), fileName.replace(/\.js$/, '.ts'));
      const cycle = visit(dependency);
      if (cycle.length > 0) return cycle;
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

  // REGRESSION: fails if sdk-transport.ts imports McpTransportLike from './tool-server.js' again.
  it('keeps the MCP server and its SDK adapter acyclic', () => {
    expect(findCycle({ entry: resolve(packagesRoot, 'mcp/src/server/tool-server.ts') })).toEqual([]);
  });
});

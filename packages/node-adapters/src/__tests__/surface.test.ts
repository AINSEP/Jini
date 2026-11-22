import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as agentPluginBindings from '../agent-plugins.js';
import * as fsBindings from '../fs.js';
import * as processBindings from '../process.js';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  exports: Record<string, { types: string; import: string; default: string }>;
  jini: { kind: string; entries: Record<string, string> };
};
/** One subpath per binding family; a later lane adds its own entry in its own commit. */
const SURFACE: Readonly<Record<string, { readonly module: object; readonly names: readonly string[] }>> = {
  './agent-plugins': { module: agentPluginBindings, names: ['createNodeAgentPluginEffects'] },
  './fs': { module: fsBindings, names: ['nodeAtomicWriter', 'nodeFileLock'] },
  './process': { module: processBindings, names: ['createProcessControlPort', 'createSpawnPort', 'nodeCommandShell', 'nodeSpawnPort'] },
};

describe('@jini-ai/node-adapters public surface', () => {
  it('is a runtime-adapter with no root barrel and exactly the listed subpaths', () => {
    expect(manifest.jini.kind).toBe('runtime-adapter');
    expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(SURFACE).sort());
    expect(Object.keys(manifest.jini.entries).sort()).toEqual(Object.keys(SURFACE).sort());
    expect(Object.keys(manifest.exports)).not.toContain('.');
  });

  it.each(Object.entries(SURFACE))('%s maps dist to an existing source file and exports exactly the listed bindings', (subpath, { module, names }) => {
    const source = subpath.slice('./'.length);
    expect(manifest.exports[subpath]).toEqual({ types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js` });
    expect(existsSync(fileURLToPath(new URL(`src/${source}.ts`, root)))).toBe(true);
    expect(Object.keys(module).sort()).toEqual([...names].sort());
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strategiesForDef } from '../runtime-strategies.js';
import { fakeAtomicWriter, fakeFileLock, type EffectLog } from '../defs/__tests__/fakes/file-ports.js';

const home = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => home.path }));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });

describe('mcpBridge strategy slot', () => {
  it('is bound for the agy definition only', () => {
    expect(strategiesForDef({ def: { id: 'antigravity', externalMcpInjection: 'env-passthrough' } }).mcpBridge).toBeDefined();
    expect(strategiesForDef({ def: { id: 'another-agent', externalMcpInjection: 'env-passthrough' } }).mcpBridge).toBeUndefined();
  });

  it('grants the Jini server in the CLI own settings file, through the supplied lock and writer, for an env-passthrough delivery only', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'agy-slot-'));
    roots.push(root);
    home.path = root;
    const settingsPath = join(root, '.gemini', 'antigravity-cli', 'settings.json');
    await fs.mkdir(join(root, '.gemini', 'antigravity-cli'), { recursive: true });
    await fs.writeFile(settingsPath, '{}');
    const slot = strategiesForDef({ def: { id: 'antigravity', externalMcpInjection: 'env-passthrough' } }).mcpBridge!;
    const log: EffectLog = [];
    const required = { serverName: 'jini', fileLock: fakeFileLock({ log }), writer: fakeAtomicWriter({ log }) };
    await slot.prepare({ ...required, delivery: { kind: 'claude-mcp-json' } });
    await slot.prepare({ ...required, delivery: null });
    expect(log).toEqual([]);
    await slot.prepare({ ...required, delivery: { kind: 'env-passthrough' } });
    expect(log).toEqual(['lock', `backup:${settingsPath}`, `text:${settingsPath}`, 'unlock']);
  });
});

import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { createVibecodingSession, createVibecodingToolRunner } from '../../session.js';
import { createVibecodingSession as compatibilitySession } from '../../react/session.js';
import { createVibecodingToolRunner as compatibilityRunner } from '../../react/tools.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
test('React compatibility paths re-export the identical framework-free implementations', () => {
  expect(compatibilitySession).toBe(createVibecodingSession);
  expect(compatibilityRunner).toBe(createVibecodingToolRunner);
});
test('packed ./session imports and runs with every React resolution forbidden', async () => {
  // The reviewer builds first: this test intentionally exercises published dist, not TS aliases.
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-packed-')); roots.push(base);
  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--pack-destination', base],
    { cwd: packageRoot, env: { ...process.env, npm_config_cache: join(base, 'cache') }, stdio: 'pipe', shell: process.platform === 'win32' });
  const tarball = (await fs.readdir(base)).find(name => name.endsWith('.tgz'))!;
  const installed = join(base, 'node_modules', '@jini-ai', 'vibecoding');
  await fs.mkdir(installed, { recursive: true });
  execFileSync('tar', ['-xzf', join(base, tarball), '--strip-components=1', '-C', installed], { stdio: 'pipe' });
  // Reuse installed core dependencies; vibecoding itself must come entirely from the tarball.
  await fs.symlink(resolve(packageRoot, '../core'), join(base, 'node_modules', '@jini-ai', 'core'), process.platform === 'win32' ? 'junction' : 'dir');
  const loader = join(base, 'no-react.mjs');
  await fs.writeFile(loader, `export async function resolve(specifier, context, next) {
    if (/^react(?:-dom)?(?:\\/|$)/.test(specifier)) throw new Error('React reached from session: ' + specifier);
    return next(specifier, context);
  }`);
  const source = `
    import { createVibecodingSession, createVibecodingToolRunner } from '@jini-ai/vibecoding/session';
    const parts = new Map([['a', 'before']]);
    const target = {
      listParts: async () => [...parts.keys()].map(id => ({ id })),
      readPart: async ({ id }) => parts.get(id),
      replacePart: async ({ id, content }) => { parts.set(id, content); },
      validate: async () => ({ ok: true }),
      snapshot: async () => ({ id: 's', parts: Object.fromEntries(parts) }),
      restore: async () => {},
    };
    const session = createVibecodingSession({ target });
    const runner = createVibecodingToolRunner({ session });
    await runner.run({ toolId: 'vibecoding.propose_edits', input: { edits: [{ id: 'a', content: 'after' }] } });
    await session.undo();
    process.stdout.write(JSON.stringify({ content: parts.get('a'), canRedo: session.history.canRedo() }));
  `;
  const result = execFileSync(process.execPath, ['--loader', pathToFileURL(loader).href, '--input-type=module', '--eval', source],
    { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  expect(JSON.parse(result)).toEqual({ content: 'before', canRedo: true });
  const manifest = JSON.parse(await fs.readFile(join(installed, 'package.json'), 'utf8'));
  expect(manifest.jini.entries['./session']).toBe('universal');
  expect(manifest.exports['./session'].import).toBe('./dist/session.js');
}, 60_000);

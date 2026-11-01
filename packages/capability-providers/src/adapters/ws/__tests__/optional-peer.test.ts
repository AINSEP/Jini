import { mkdtempSync, copyFileSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('injected WebSocket servers work without ws; a broken installed adapter is not reported as absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'jini-ws-opt-in-'));
  try {
    copyFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), join(root, 'ws.ts'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    // A package with no entry file prevents a globally installed ws from masking the missing code.
    const ws = join(root, 'node_modules/ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'ws', exports: './absent.cjs' }));
    const core = join(root, 'node_modules/@jini-ai/core');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'package.json'), JSON.stringify({ type: 'module', exports: { './optional-peer': './optional-peer.ts' } }));
    symlinkSync(fileURLToPath(new URL('../../../../../core/src/optional-peer.ts', import.meta.url)), join(core, 'optional-peer.ts'));
    const script = `const { createWebSocketRealtimeProvider } = await import(${JSON.stringify(pathToFileURL(join(root, 'ws.ts')).href)});
      const server = { on() {} };
      const injected = createWebSocketRealtimeProvider({ wsOptions: {} }, { createServer: () => server });
      if (injected.server !== server) process.exitCode = 2;
      try { createWebSocketRealtimeProvider({ wsOptions: {} }); process.exitCode = 3; }
      catch (error) { console.log(JSON.stringify({ message: error.message, cause: error.cause?.code })); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ message: 'WebSocket realtime adapter could not load ws. Check its installed dependencies and native binaries.', cause: 'MODULE_NOT_FOUND' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { prepareClaudeHttpMcpConfig } from '../mcp-config.js';

it('HTTP credentials appear only in the private config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'http-project-'));
  const config = await prepareClaudeHttpMcpConfig({ cwd, endpoint: { url: 'http://127.0.0.1:1234/mcp', token: 'listener' } });
  try {
    expect(dirname(config.path)).not.toBe(cwd);
    expect(JSON.parse(await readFile(config.path, 'utf8'))).toEqual({ mcpServers: { jini: { type: 'http', url: 'http://127.0.0.1:1234/mcp', headers: { Authorization: 'Bearer listener' } } } });
    if (process.platform !== 'win32') {
      expect((await stat(dirname(config.path))).mode & 0o777).toBe(0o700);
      expect((await stat(config.path)).mode & 0o777).toBe(0o600);
    }
  } finally { await config.cleanup(); await rm(cwd, { recursive: true }); }
});

it('same-directory runs cannot overwrite each other', async () => {
  const configs = await Promise.all(['first', 'second'].map(token => prepareClaudeHttpMcpConfig({ cwd: '/unavailable-project', endpoint: { url: 'http://127.0.0.1:1234/mcp', token } })));
  try {
    expect(configs[0]!.path).not.toBe(configs[1]!.path);
    await configs[0]!.cleanup();
    expect(await readFile(configs[1]!.path, 'utf8')).toContain('Bearer second');
  } finally { await Promise.all(configs.map(config => config.cleanup())); }
});

it('private HTTP config preserves only permitted project servers', async () => {
  const readFile = vi.fn(async () => '{"mcpServers":{"personal":{"command":"personal"},"jini":{"command":"stale","env":{"JINI_DAEMON_TOKEN":"callback"}}}}');
  const endpoint = { url: 'http://127.0.0.1:1234/mcp', token: 'listener' };
  const inherited = await prepareClaudeHttpMcpConfig({ cwd: '/fixture', endpoint }, { readFile });
  const isolated = await prepareClaudeHttpMcpConfig({ cwd: '/fixture', endpoint }, { readFile, inheritUserMcp: false });
  try {
    const withUser = JSON.parse(await readFileFromDisk(inherited.path));
    const withoutUser = JSON.parse(await readFileFromDisk(isolated.path));
    expect(withUser.mcpServers.personal).toEqual({ command: 'personal' });
    expect(withoutUser.mcpServers.personal).toBeUndefined();
    expect(withUser.mcpServers.jini.type).toBe('http');
    expect(JSON.stringify(withUser)).not.toContain('callback');
    expect(readFile).toHaveBeenCalledTimes(1);
  } finally { await inherited.cleanup(); await isolated.cleanup(); }
});

const readFileFromDisk = (path: string) => readFile(path, 'utf8');

import assert from 'node:assert/strict';
import { expect, it } from 'vitest';
import { buildMcpInstallPayload } from '../core/install-info.js';
import { getDaemonJson } from '../server/daemon-client.js';
import { getRunTool } from '../server/tools/run-tools.js';

it('keeps the resolved data root pinned despite conflicting sidecar environment', () => {
  const sidecarEnv = { APP_DATA_DIR: '/wrong', SOCKET: '/socket' };
  const payload = buildMcpInstallPayload({ cliPath: '/cli.js', cliExists: true, execPath: '/node', nodeExists: true,
    port: 1234, platform: 'linux', dataDir: '/resolved', dataDirEnvVar: 'APP_DATA_DIR', electronAsNode: false,
    isSidecarMode: true, sidecarEnv });
  expect(payload.env).toEqual({ APP_DATA_DIR: '/resolved', SOCKET: '/socket' });
  expect(sidecarEnv.APP_DATA_DIR).toBe('/wrong');
});

it.each(['network', 'http', 'size'])('redacts URL credentials and queries from %s diagnostics', async failure => {
  const baseUrl = 'http://user:password@localhost:1234/?token=small-secret';
  const fetchImpl: typeof fetch = async () => {
    if (failure === 'network') throw Object.assign(new Error('failed'), { cause: { code: 'ECONNREFUSED' } });
    if (failure === 'size') return new Response('too large');
    return new Response(JSON.stringify({ error: { code: 'bad\u001b[31m http://user:password@localhost/?token=small-secret',
      message: 'see http://user:password@localhost/?token=small-secret' } }), { status: 403 });
  };
  const error = await getDaemonJson({ baseUrl, route: '/api/runs' }, { fetchImpl, maxResponseBytes: failure === 'size' ? 1 : 4096 }).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  assert.ok(error instanceof Error);
  expect(error.message).not.toMatch(/user|password|small-secret|token=|\u001b/);
  expect(error.message).toContain('localhost');
});

it('describes every declared RunState with the protocol spelling', () => {
  expect(getRunTool.description).toContain('queued|starting|running|succeeded|failed|cancelled');
});

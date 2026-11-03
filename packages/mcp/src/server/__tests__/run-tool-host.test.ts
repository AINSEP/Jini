import { expect, it, vi } from 'vitest';
import { assembleRunToolHost } from '../run-tool-host.js';
import { serve } from '../../bin/serve.js';

it('stdio and HTTP assemble the same run surface', async () => {
  const resolveBaseUrl = async () => 'http://daemon.invalid';
  const expected = await assembleRunToolHost({ runId: 'run-1', resolveBaseUrl }, { credential: 'callback', messageRelayNonce: 'a'.repeat(48) });
  const create = vi.fn(() => ({ run: async () => {} }));
  await serve({}, { env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_TOKEN: 'callback', JINI_MESSAGE_RELAY: '1', JINI_MESSAGE_RELAY_NONCE: 'a'.repeat(48) },
    resolveDaemonUrl: resolveBaseUrl, createMcpToolServer: create });
  const [required, options] = create.mock.calls[0] as unknown as [typeof expected.required, typeof expected.options];
  expect(required.tools.map(tool => tool.name)).toEqual(expected.required.tools.map(tool => tool.name));
  expect(options.resources?.map(resource => resource.uri)).toEqual(expected.options.resources?.map(resource => resource.uri));
  expect(options.instructions).toBe(expected.options.instructions);
  expect(options.authHeaders).toEqual(expected.options.authHeaders);
  expect(options.delegatedTools).toEqual(expected.options.delegatedTools);
  expect(options.messageRelay).toEqual(expected.options.messageRelay);
  expect(options.resultPaging).toBe(expected.options.resultPaging);
});

it('assembly uses explicit inputs without process environment', async () => {
  const host = await assembleRunToolHost({ runId: 'explicit-run', resolveBaseUrl: () => 'http://explicit.invalid' }, { credential: 'explicit-token' });
  expect(await host.required.resolveBaseUrl()).toBe('http://explicit.invalid');
  expect(host.options.authHeaders).toEqual({ Authorization: 'Bearer explicit-token' });
  expect(host.options.delegatedTools?.runId).toBe('explicit-run');
  expect(host.options.resultPaging).toBe(true);
  expect(host.options.delegatedTools?.initialTools).toEqual([]);
  expect(host.required.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['execute_delegated_tool', 'execute_readonly_delegated_tool', 'describe_tool', 'wait_for']));
  expect(host.options.instructions).toContain('read_tool_result');
});

it('absent explicit credentials and metadata never inherit another process run', async () => {
  vi.stubEnv('JINI_DAEMON_TOKEN', 'foreign-callback');
  vi.stubEnv('JINI_STARTUP_TOOL_IDS', '["foreign.tool"]');
  vi.stubEnv('JINI_MESSAGE_RELAY', '1');
  vi.stubEnv('JINI_MESSAGE_RELAY_NONCE', 'a'.repeat(48));
  try {
    const fetchImpl = vi.fn<typeof fetch>();
    const host = await assembleRunToolHost({ runId: 'explicit-run', resolveBaseUrl: () => 'http://explicit.invalid' }, { fetchImpl });
    expect(host.options.authHeaders).toBeUndefined();
    expect(host.options.messageRelay).toBeUndefined();
    expect(host.options.delegatedTools?.initialTools).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});

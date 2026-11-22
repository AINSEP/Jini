import { expect, it, vi } from 'vitest';
import { createConsoleLogger, type LogDiagnosticRecord } from '@jini-ai/core/primitives';
import { readMcpConfig } from '../config.js';
import { clearToken, getToken, readAllTokens, setToken } from '../tokens.js';

it('returns empty corrupt config through the safe sink without changing the source', async () => {
  const raw = '{"PRIVATE_CONFIG_SENTINEL"';
  const diagnostics: LogDiagnosticRecord[] = [];
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const writeSecretText = vi.fn();
  try {
    const result = await readMcpConfig({ dataDir: '/data', files: { readText: async () => raw, writer: { writeText: writeSecretText } } }, { report: createConsoleLogger({ prefix: '' }, { diagnostics: record => diagnostics.push(record) }) });
    expect(result).toEqual({ servers: [] });
    expect(writeSecretText).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledWith('The MCP config file /data/mcp-config.json is not valid JSON; reading it as an empty server list.', 'SyntaxError');
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE_CONFIG_SENTINEL');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.error).toBeInstanceOf(SyntaxError);
  } finally { error.mockRestore(); }
});

it.each(['get', 'set', 'clear', 'all'] as const)('forwards %s token reporting and preserves corrupt recovery bytes', async operation => {
  const raw = '{"PRIVATE_TOKEN_SENTINEL"';
  const writes: Array<{ filePath: string; contents: string }> = [];
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const clock = { nowMs: () => 0 };
  const files = { readText: async () => raw, writer: { writeText: async ({ filePath, content }: { filePath: string; content: string }) => { writes.push({ filePath, contents: content }); } } };
  const required = { dataDir: '/data', serverId: 'server', clock, files };
  const options = { report: createConsoleLogger({ prefix: '' }) };
  try {
    if (operation === 'get') expect(await getToken(required, options)).toBeNull();
    if (operation === 'clear') await clearToken(required, options);
    if (operation === 'all') expect(await readAllTokens(required, options)).toEqual({});
    if (operation === 'set') await setToken({ ...required, token: { accessToken: 'new', tokenType: 'Bearer', savedAt: 0 } }, options);
    expect(writes[0]).toEqual({ filePath: expect.stringMatching(/mcp-tokens\.json\.corrupt-[a-f0-9]{64}$/), contents: raw });
    expect(writes).toHaveLength(operation === 'set' ? 2 : 1);
    expect(error).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledWith(expect.stringMatching(/^The MCP token file \/data\/mcp-tokens\.json is not valid JSON; kept a copy beside it/), 'SyntaxError');
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE_TOKEN_SENTINEL');
  } finally { error.mockRestore(); }
});

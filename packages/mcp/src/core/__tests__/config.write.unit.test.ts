import { describe, expect, it } from 'vitest';
import { fakeAtomicWriter } from '@jini-ai/core/contracts/runtime/testing';
import { writeMcpConfig, type McpConfigFilesPort } from '../config.js';
import { clearToken, readTokensFile, setToken } from '../tokens.js';

const clock = { nowMs: () => 123 };
const token = { accessToken: 'access', tokenType: 'Bearer', savedAt: 123 };
const secretOptions = { mode: 0o600, verifyOwnerOnly: true, createParent: true };

function recordingFiles() {
  const writer = fakeAtomicWriter();
  const files: McpConfigFilesPort = {
    writer,
    readText: async ({ filePath }) => {
      const text = writer.files.get(filePath);
      if (typeof text !== 'string') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return text;
    },
  };
  return { files, writer };
}

describe('MCP secret write policy', () => {
  it('writes sanitized config bytes with exactly the owner-only atomic options', async () => {
    const { files, writer } = recordingFiles();
    const config = await writeMcpConfig({ dataDir: '/config', body: { servers: [] }, files });
    expect(config).toEqual({ servers: [] });
    expect(writer.writes).toEqual([
      { method: 'writeText', filePath: '/config/mcp-config.json', options: secretOptions },
    ]);
    expect(writer.files.get('/config/mcp-config.json')).toBe(JSON.stringify(config, null, 2));
  });

  it('uses the owner-only atomic options for both token set and clear', async () => {
    const { files, writer } = recordingFiles();
    await setToken({ dataDir: '/tokens', serverId: 'remote', token, clock, files });
    expect(writer.files.get('/tokens/mcp-tokens.json')).toBe(JSON.stringify({ servers: { remote: token } }, null, 2));
    await clearToken({ dataDir: '/tokens', serverId: 'remote', clock, files });
    expect(writer.writes).toEqual([
      { method: 'writeText', filePath: '/tokens/mcp-tokens.json', options: secretOptions },
      { method: 'writeText', filePath: '/tokens/mcp-tokens.json', options: secretOptions },
    ]);
    expect(writer.files.get('/tokens/mcp-tokens.json')).toBe(JSON.stringify({ servers: {} }, null, 2));
  });

  it('backs up corrupt token bytes through the owner-only writer before replacement', async () => {
    const { files, writer } = recordingFiles();
    const corrupt = '{ broken';
    writer.files.set('/recovery/mcp-tokens.json', corrupt);
    await setToken({ dataDir: '/recovery', serverId: 'remote', token, clock, files });
    expect(writer.writes).toEqual([
      { method: 'writeText', filePath: expect.stringMatching(/^\/recovery\/mcp-tokens\.json\.corrupt-[a-f0-9]{64}$/), options: secretOptions },
      { method: 'writeText', filePath: '/recovery/mcp-tokens.json', options: secretOptions },
    ]);
    expect(writer.files.get(writer.writes[0]!.filePath)).toBe(corrupt);
    expect(await readTokensFile({ dataDir: '/recovery', clock, files })).toEqual({ servers: { remote: token } });
  });
});

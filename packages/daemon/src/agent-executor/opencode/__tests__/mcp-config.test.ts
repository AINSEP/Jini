import { expect, it } from 'vitest';
import { mergeOpenCodeHttpMcpConfig } from '../mcp-config.js';
import { mergeEnvContentInstructions } from '../../mcp-bridge.js';

it('inline HTTP delivery preserves settings permissions and instructions', () => {
  const existingRaw = JSON.stringify({ theme: 'dark', permission: { bash: 'deny' }, instructions: ['user.md'], mcp: { personal: { type: 'local', command: ['personal'] }, jini: { type: 'local', command: ['serve.js'], environment: { JINI_DAEMON_TOKEN: 'callback' } } } });
  const http = mergeOpenCodeHttpMcpConfig({ existingRaw, endpoint: { url: 'http://127.0.0.1:1234/mcp', token: 'listener' } });
  const merged = JSON.parse(mergeEnvContentInstructions({ existingRaw: http, instructionsFilePath: 'overlay.md' }));
  expect(merged).toEqual({ theme: 'dark', permission: { bash: 'deny' }, instructions: ['user.md', 'overlay.md'], mcp: {
    personal: { type: 'local', command: ['personal'] }, jini: { type: 'remote', url: 'http://127.0.0.1:1234/mcp', headers: { Authorization: 'Bearer listener' } },
  } });
  expect(http).not.toContain('callback');
  expect(http).not.toContain('serve.js');
});

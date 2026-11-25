import { describe, expect, it } from 'vitest';
import { strategiesForDef } from '../runtime-strategies.js';

describe('envContent strategy slot', () => {
  it('is bound by the declared env-content delivery strategy, for either CLI that reads the OpenCode-schema document', () => {
    expect(strategiesForDef({ def: { id: 'a', externalMcpInjection: 'opencode-env-content' } }).envContent).toBeDefined();
    expect(strategiesForDef({ def: { id: 'b', externalMcpInjection: 'mimo-env-content' } }).envContent).toBeDefined();
    expect(strategiesForDef({ def: { id: 'c', externalMcpInjection: 'acp-merge' } }).envContent).toBeUndefined();
    expect(strategiesForDef({ def: { id: 'd' } }).envContent).toBeUndefined();
  });

  it('merges the bridge entry under the supplied server name, keeping what the host already put in the document', () => {
    const { envContent } = strategiesForDef({ def: { id: 'a', externalMcpInjection: 'opencode-env-content' } });
    const merged = envContent!.mergeMcp({
      existingRaw: JSON.stringify({ theme: 'dark', mcp: { personal: { type: 'local', command: ['personal'] } } }),
      entry: { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'r1' } }, serverName: 'bridge-key',
    });
    expect(JSON.parse(merged)).toEqual({ theme: 'dark', mcp: {
      personal: { type: 'local', command: ['personal'] },
      'bridge-key': { type: 'local', command: ['jini-mcp', '--quiet'], environment: { JINI_RUN_ID: 'r1' }, enabled: true },
    } });
  });
});

describe('instructionsDocument strategy slot', () => {
  it('is bound by the declared system-prompt delivery strategy, whatever the MCP delivery is', () => {
    const delivery = { strategy: 'config-instructions-file', varName: 'CFG' } as const;
    expect(strategiesForDef({ def: { id: 'x', systemPromptDelivery: delivery } }).instructionsDocument).toBeDefined();
    expect(strategiesForDef({ def: { id: 'y', externalMcpInjection: 'opencode-env-content' } }).instructionsDocument).toBeUndefined();
  });

  it('appends the overlay path after the instructions the host already carries, beside the mcp key', () => {
    const { instructionsDocument } = strategiesForDef({ def: { id: 'x', systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'CFG' } } });
    const merged = instructionsDocument!.merge({ existingRaw: JSON.stringify({ instructions: ['user.md'], mcp: { a: 1 } }), instructionsFilePath: 'overlay.md' });
    expect(JSON.parse(merged)).toEqual({ instructions: ['user.md', 'overlay.md'], mcp: { a: 1 } });
  });
});

describe('httpMcpEnv strategy slot', () => {
  it('is bound by definition id for the two CLIs that read the endpoint from the inline document, and not for the Mimo def', () => {
    expect(strategiesForDef({ def: { id: 'opencode', externalMcpInjection: 'opencode-env-content' } }).httpMcpEnv).toBeDefined();
    expect(strategiesForDef({ def: { id: 'opencode-acp', externalMcpInjection: 'opencode-env-content' } }).httpMcpEnv).toBeDefined();
    expect(strategiesForDef({ def: { id: 'mimo', externalMcpInjection: 'mimo-env-content' } }).httpMcpEnv).toBeUndefined();
  });

  it('writes the remote entry into the named variable and leaves every other env entry alone', () => {
    const { httpMcpEnv } = strategiesForDef({ def: { id: 'opencode', externalMcpInjection: 'opencode-env-content' } });
    const env = httpMcpEnv!({ env: { PATH: '/bin', CFG: JSON.stringify({ permission: { bash: 'deny' } }) }, envVar: 'CFG', serverName: 'jini', endpoint: { url: 'http://127.0.0.1:1/mcp', token: 't' } });
    expect(env.PATH).toBe('/bin');
    expect(JSON.parse(env.CFG!)).toEqual({ permission: { bash: 'deny' }, mcp: { jini: { type: 'remote', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } } } });
  });
});

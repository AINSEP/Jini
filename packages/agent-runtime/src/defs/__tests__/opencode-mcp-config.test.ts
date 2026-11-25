import { describe, expect, it } from 'vitest';
import { mergeEnvContentInstructions, mergeEnvContentMcpConfig, mergeOpenCodeHttpMcpConfig } from '../opencode/mcp-config.js';

it('inline HTTP delivery preserves settings permissions and instructions', () => {
  const existingRaw = JSON.stringify({ theme: 'dark', permission: { bash: 'deny' }, instructions: ['user.md'], mcp: { personal: { type: 'local', command: ['personal'] }, jini: { type: 'local', command: ['serve.js'], environment: { JINI_DAEMON_TOKEN: 'callback' } } } });
  const http = mergeOpenCodeHttpMcpConfig({ existingRaw, endpoint: { url: 'http://127.0.0.1:1234/mcp', token: 'listener' }, serverName: 'jini' });
  const merged = JSON.parse(mergeEnvContentInstructions({ existingRaw: http, instructionsFilePath: 'overlay.md' }));
  expect(merged).toEqual({ theme: 'dark', permission: { bash: 'deny' }, instructions: ['user.md', 'overlay.md'], mcp: {
    personal: { type: 'local', command: ['personal'] }, jini: { type: 'remote', url: 'http://127.0.0.1:1234/mcp', headers: { Authorization: 'Bearer listener' } },
  } });
  expect(http).not.toContain('callback');
  expect(http).not.toContain('serve.js');
});

describe('mergeEnvContentMcpConfig', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };
  const jiniEntry = {
    type: 'local',
    command: ['jini-mcp', '--quiet'],
    environment: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' },
    enabled: true,
  };

  it('produces a fresh OpenCode-schema document when the variable was unset', () => {
    expect(JSON.parse(mergeEnvContentMcpConfig({ existingRaw: undefined, entry: entry, serverName: 'jini' }))).toEqual({ mcp: { jini: jiniEntry } });
  });

  it('treats an empty-string existing value as unset', () => {
    expect(JSON.parse(mergeEnvContentMcpConfig({ existingRaw: '', entry: entry, serverName: 'jini' }))).toEqual({ mcp: { jini: jiniEntry } });
  });

  // The variable a host uses to hand the CLI the *user's* own MCP servers is the same variable this
  // bridge rides in. Clobbering it would silently delete them.
  it('preserves unrelated top-level keys and other registered servers', () => {
    const existing = JSON.stringify({ provider: { openai: {} }, mcp: { other: { type: 'local', command: ['x'] } } });
    expect(JSON.parse(mergeEnvContentMcpConfig({ existingRaw: existing, entry: entry, serverName: 'jini' }))).toEqual({
      provider: { openai: {} },
      mcp: { other: { type: 'local', command: ['x'] }, jini: jiniEntry },
    });
  });

  it('overwrites a stale "jini" entry rather than merging into it', () => {
    const existing = JSON.stringify({ mcp: { jini: { type: 'local', command: ['stale'], enabled: false } } });
    expect(JSON.parse(mergeEnvContentMcpConfig({ existingRaw: existing, entry: entry, serverName: 'jini' })).mcp.jini).toEqual(jiniEntry);
  });

  it('starts fresh for content that is not valid JSON, a JSON array, or has a non-object "mcp" field', () => {
    for (const existing of ['{not json', '[1,2,3]', JSON.stringify({ mcp: 'not-an-object' })]) {
      expect(JSON.parse(mergeEnvContentMcpConfig({ existingRaw: existing, entry: entry, serverName: 'jini' }))).toMatchObject({ mcp: { jini: jiniEntry } });
    }
  });

  // SEC: this whole string becomes an *environment variable value*, never argv — see the executor's
  // `childEnv` comment. Within it, the token must sit in `environment` (the MCP child's env), not in
  // `command` (which OpenCode spawns, putting it in `ps`).
  it('keeps a resolved credential in environment and out of command', () => {
    const withToken = { ...entry, env: { ...entry.env, JINI_DAEMON_TOKEN: 'run-scoped-secret' } };
    const parsed = JSON.parse(mergeEnvContentMcpConfig({ existingRaw: undefined, entry: withToken, serverName: 'jini' }));
    expect(parsed.mcp.jini.command).toEqual(['jini-mcp', '--quiet']);
    expect(JSON.stringify(parsed.mcp.jini.command)).not.toContain('run-scoped-secret');
    expect(parsed.mcp.jini.environment.JINI_DAEMON_TOKEN).toBe('run-scoped-secret');
  });
});

describe('mergeEnvContentInstructions', () => {
  it('starts a fresh document when there is no existing value', () => {
    expect(JSON.parse(mergeEnvContentInstructions({ existingRaw: undefined, instructionsFilePath: '/tmp/overlay.md' }))).toEqual({
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('appends to, never clobbers, an existing instructions array', () => {
    const existing = JSON.stringify({ instructions: ['/existing/one.md'] });
    expect(JSON.parse(mergeEnvContentInstructions({ existingRaw: existing, instructionsFilePath: '/tmp/overlay.md' }))).toEqual({
      instructions: ['/existing/one.md', '/tmp/overlay.md'],
    });
  });

  it('preserves an existing mcp key untouched, alongside the new instructions entry — the coexistence this whole mechanism depends on', () => {
    const existing = JSON.stringify({ mcp: { jini: { type: 'local', command: ['node', 'x.mjs'], environment: {}, enabled: true } } });
    const merged = JSON.parse(mergeEnvContentInstructions({ existingRaw: existing, instructionsFilePath: '/tmp/overlay.md' }));
    expect(merged).toEqual({
      mcp: { jini: { type: 'local', command: ['node', 'x.mjs'], environment: {}, enabled: true } },
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('starts fresh (does not throw) when the existing value is unparseable JSON', () => {
    expect(JSON.parse(mergeEnvContentInstructions({ existingRaw: 'not json{', instructionsFilePath: '/tmp/overlay.md' }))).toEqual({
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('ignores non-string entries in an existing instructions array rather than propagating malformed data', () => {
    const existing = JSON.stringify({ instructions: ['/existing/one.md', 42, null] });
    expect(JSON.parse(mergeEnvContentInstructions({ existingRaw: existing, instructionsFilePath: '/tmp/overlay.md' }))).toEqual({
      instructions: ['/existing/one.md', '/tmp/overlay.md'],
    });
  });
});

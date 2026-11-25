import { describe, expect, it } from 'vitest';
import { mergeMcpJsonContent } from '../claude/mcp-json.js';

describe('mergeMcpJsonContent', () => {
  const entry = { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  it('produces a fresh document when no existing content is given', () => {
    expect(JSON.parse(mergeMcpJsonContent({ existingRaw: undefined, serverEntry: entry, serverName: 'jini' }))).toEqual({ mcpServers: { jini: entry } });
  });

  it('preserves unrelated top-level keys and other registered servers', () => {
    const existing = JSON.stringify({ someOtherKey: true, mcpServers: { other: { command: 'other-bin', args: [], env: {} } } });
    const merged = JSON.parse(mergeMcpJsonContent({ existingRaw: existing, serverEntry: entry, serverName: 'jini' }));
    expect(merged).toEqual({
      someOtherKey: true,
      mcpServers: { other: { command: 'other-bin', args: [], env: {} }, jini: entry },
    });
  });

  it('overwrites a pre-existing "jini" entry rather than merging into it', () => {
    const existing = JSON.stringify({ mcpServers: { jini: { command: 'stale', args: ['--old'], env: {} } } });
    const merged = JSON.parse(mergeMcpJsonContent({ existingRaw: existing, serverEntry: entry, serverName: 'jini' }));
    expect(merged.mcpServers.jini).toEqual(entry);
  });

  it('starts fresh when the existing content is not valid JSON', () => {
    expect(JSON.parse(mergeMcpJsonContent({ existingRaw: '{not json', serverEntry: entry, serverName: 'jini' }))).toEqual({ mcpServers: { jini: entry } });
  });

  it('starts fresh when the existing content parses to a JSON array, not an object', () => {
    expect(JSON.parse(mergeMcpJsonContent({ existingRaw: '[1,2,3]', serverEntry: entry, serverName: 'jini' }))).toEqual({ mcpServers: { jini: entry } });
  });

  it('starts fresh when the existing document has a non-object "mcpServers" field', () => {
    const existing = JSON.stringify({ mcpServers: 'not-an-object' });
    expect(JSON.parse(mergeMcpJsonContent({ existingRaw: existing, serverEntry: entry, serverName: 'jini' }))).toEqual({ mcpServers: { jini: entry } });
  });

  it('emits pretty-printed JSON terminated by a trailing newline', () => {
    const content = mergeMcpJsonContent({ existingRaw: undefined, serverEntry: entry, serverName: 'jini' });
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('\n  "mcpServers"');
  });
});

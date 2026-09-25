import { describe, expect, it } from 'vitest';
import { buildCodexHomeConfigToml, buildCodexMcpServerToml } from '../agent-executor.js';

const entry: Parameters<typeof buildCodexMcpServerToml>[0] = {
  command: '/usr/bin/node',
  args: ['/opt/jini/serve.js'],
  env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4000', JINI_DAEMON_TOKEN: 'tok-1' },
};

describe('buildCodexHomeConfigToml', () => {
  it('does not duplicate the [mcp_servers.jini] table when the operator config already has one', () => {
    const existing = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.jini]',
      'command = "/old/stale/node"',
      'args = ["/old/stale/serve.js"]',
      '',
      '[mcp_servers.jini.env]',
      'JINI_RUN_ID = "stale-run"',
      '',
      '[sandbox]',
      'policy = "workspace-write"',
    ].join('\n');

    const result = buildCodexHomeConfigToml(existing, entry);

    const jiniTableOccurrences = result.split('[mcp_servers.jini]').length - 1;
    expect(jiniTableOccurrences).toBe(1);
    // The operator's own unrelated settings must survive untouched.
    expect(result).toContain('model = "gpt-5"');
    expect(result).toContain('[sandbox]');
    expect(result).toContain('policy = "workspace-write"');
    // The stale entry must be gone, replaced by this run's own.
    expect(result).not.toContain('/old/stale/node');
    expect(result).not.toContain('stale-run');
    expect(result).toContain(buildCodexMcpServerToml(entry));
  });

  it('appends normally when no pre-existing [mcp_servers.jini] table is present', () => {
    const existing = 'model = "gpt-5"\n';
    const result = buildCodexHomeConfigToml(existing, entry);
    expect(result.split('[mcp_servers.jini]').length - 1).toBe(1);
    expect(result).toContain('model = "gpt-5"');
    expect(result).toContain(buildCodexMcpServerToml(entry));
  });

  it('handles an undefined existing config (fresh Codex install)', () => {
    const result = buildCodexHomeConfigToml(undefined, entry);
    expect(result).toBe(buildCodexMcpServerToml(entry));
  });

  // Regression: 6a3c9199's header regex required the line to be exactly `[...]` with only
  // trailing whitespace, so a hand-edited header carrying a trailing comment was never
  // recognized as the jini table — the exact "hand-edited config" scenario that commit's own
  // message names. A second table got appended, which is the duplicate key Codex's parser
  // rejects at startup.
  it('does not duplicate the table when the operator hand-annotated the header with a trailing comment', () => {
    const existing = ['model = "gpt-5"', '', '[mcp_servers.jini] # added by hand', 'command = "/old/stale/node"'].join(
      '\n',
    );

    const result = buildCodexHomeConfigToml(existing, entry);

    expect(result.split('[mcp_servers.jini]').length - 1).toBe(1);
    expect(result).not.toContain('/old/stale/node');
    expect(result).toContain('model = "gpt-5"');
  });

  it('recognizes other spacing/formatting variants of the same header', () => {
    const variants = [
      '[mcp_servers.jini]   ', // trailing whitespace, no comment
      '   [mcp_servers.jini]', // leading indentation
      '[ mcp_servers.jini ]', // whitespace inside the brackets
      '["mcp_servers"."jini"]', // quoted dotted-key form
    ];
    for (const header of variants) {
      const existing = ['model = "gpt-5"', '', header, 'command = "/old/stale/node"'].join('\n');
      const result = buildCodexHomeConfigToml(existing, entry);
      expect(result.split('[mcp_servers.jini]').length - 1, `variant: ${JSON.stringify(header)}`).toBe(1);
      expect(result, `variant: ${JSON.stringify(header)}`).not.toContain('/old/stale/node');
    }
  });

  it('does not treat a differently-named or nested-subtable header as the jini table (no false positive)', () => {
    // [mcp_servers.jini.env] is a real subtable this driver already intentionally strips
    // alongside the main table (see stripExistingJiniMcpServerTable's own doc) — kept here as a
    // sanity check that it still collapses to exactly one occurrence post-fix, not a false
    // positive on an unrelated key.
    const existing = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.jinja]', // different server name entirely — must survive untouched
      'command = "/keep/this/one"',
      '',
      '[mcp_servers.jini.env]',
      'JINI_RUN_ID = "stale-run"',
    ].join('\n');

    const result = buildCodexHomeConfigToml(existing, entry);

    expect(result).toContain('[mcp_servers.jinja]');
    expect(result).toContain('/keep/this/one');
    expect(result).not.toContain('stale-run');
  });

  it('does not treat a commented-out header line as the section already being present', () => {
    const existing = ['model = "gpt-5"', '', '# [mcp_servers.jini]', 'command = "/old/stale/node"'].join('\n');

    const result = buildCodexHomeConfigToml(existing, entry);

    // The commented-out line is not a real header, so it is passed through untouched, and the
    // fresh table is still appended once.
    expect(result).toContain('# [mcp_servers.jini]');
    expect(result.split('[mcp_servers.jini]').length - 1).toBe(2); // the comment line + the one real table
  });
});

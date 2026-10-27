import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCodexHomeConfigToml, buildCodexMcpServerToml } from '../home-config.js';
import { resolveSourceCodexHomeDir } from '../home-staging.js';

describe('buildCodexMcpServerToml', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  // Shape verified live against installed Codex CLI 0.151.0 by round-tripping `codex mcp add` /
  // `codex mcp list` against a scratch CODEX_HOME and reading back the exact TOML it wrote.
  it('emits the [mcp_servers.jini] table plus a nested .env table', () => {
    expect(buildCodexMcpServerToml({ entry: entry })).toBe(
      '[mcp_servers.jini]\ncommand = "jini-mcp"\nargs = ["--quiet"]\ntool_timeout_sec = 400\n\n[mcp_servers.jini.env]\nJINI_RUN_ID = "run-1"\nJINI_DAEMON_URL = "http://d"\n',
    );
  });

  // The real type always carries JINI_RUN_ID/JINI_DAEMON_URL (buildMcpJsonServerEntry sets both
  // unconditionally), so an empty `env` is unreachable through production callers — the `as`
  // below constructs that state directly to exercise this function's own defensive branch.
  it('omits the .env table entirely when the entry carries no env vars', () => {
    const noEnv = { ...entry, env: {} } as typeof entry;
    expect(buildCodexMcpServerToml({ entry: noEnv })).toBe('[mcp_servers.jini]\ncommand = "jini-mcp"\nargs = ["--quiet"]\ntool_timeout_sec = 400\n');
  });

  // Codex's own per-tool default is 60 s. A delegated call parked on a human dialog outlives
  // that, and Codex then abandons it while the dialog stays answerable. The CLI's deadline must
  // outlast the bridge's own delegated-call deadline, so the bridge (which drops the daemon request
  // and so expires the dialog) always gives up first.
  it('sets tool_timeout_sec past the delegated-call deadline the bridge will use', () => {
    // 400 s = the bridge's 6 min DEFAULT_DELEGATED_TOOL_TIMEOUT_MS + 40 s.
    expect(buildCodexMcpServerToml({ entry: entry })).toContain('\ntool_timeout_sec = 400\n');
  });

  // Host-supplied bridge env (McpJsonInjectionOptions.env) can carry names that are not TOML
  // bare keys; written unquoted, `A.B` would become a nested table and `A B` a parse error.
  it('quotes env keys that are not valid TOML bare keys', () => {
    const toml = buildCodexMcpServerToml({ entry: { ...entry, env: { ELECTRON_RUN_AS_NODE: '1', 'A.B': 'x', 'A B': 'y', ...entry.env } } });
    expect(toml).toContain(
      '\n[mcp_servers.jini.env]\nELECTRON_RUN_AS_NODE = "1"\n"A.B" = "x"\n"A B" = "y"\nJINI_RUN_ID = "run-1"\nJINI_DAEMON_URL = "http://d"\n',
    );
  });

  it('serialises multiple argv tokens as a comma-separated TOML array', () => {
    const toml = buildCodexMcpServerToml({ entry: { ...entry, args: ['--a', '--b', '--c'] } });
    expect(toml).toContain('args = ["--a", "--b", "--c"]');
  });

  it('includes JINI_DAEMON_TOKEN in the .env table when the entry carries a resolved credential', () => {
    const withToken = { ...entry, env: { ...entry.env, JINI_DAEMON_TOKEN: 'run-scoped-secret' } };
    const toml = buildCodexMcpServerToml({ entry: withToken });
    expect(toml).toContain('JINI_DAEMON_TOKEN = "run-scoped-secret"');
    // SEC: the credential must land in the env table, never inside the args array (readable via `ps`).
    expect(toml.split('args = ')[1]!.split('\n')[0]).not.toContain('run-scoped-secret');
  });

  // Adversarial: a command/arg/env value carrying TOML-significant characters must not break the
  // file's syntax or let a value escape its own string.
  it('escapes backslashes, double quotes, and whitespace control characters in every string field', () => {
    const hostile = {
      command: 'C:\\bin\\jini-mcp.exe',
      args: ['--label', 'say "hi"\tthen\nnewline\r'],
      env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' },
    };
    const toml = buildCodexMcpServerToml({ entry: hostile });
    expect(toml).toContain('command = "C:\\\\bin\\\\jini-mcp.exe"');
    expect(toml).toContain('"say \\"hi\\"\\tthen\\nnewline\\r"');
  });
});

describe('buildCodexHomeConfigToml', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  it('produces just this run\'s block when there is no existing config (fresh Codex install)', () => {
    expect(buildCodexHomeConfigToml({ existingRaw: undefined, entry: entry })).toBe(buildCodexMcpServerToml({ entry: entry }));
  });

  it('appends after existing content that already ends with a newline, with exactly one blank-line separator', () => {
    const existing = '[sandbox]\nmode = "workspace-write"\n';
    const result = buildCodexHomeConfigToml({ existingRaw: existing, entry: entry });
    expect(result).toBe(`${existing}\n${buildCodexMcpServerToml({ entry: entry })}`);
  });

  it('finishes a trailing partial line before appending, when existing content has no trailing newline', () => {
    const existing = '[sandbox]\nmode = "workspace-write"';
    const result = buildCodexHomeConfigToml({ existingRaw: existing, entry: entry });
    expect(result).toBe(`${existing}\n\n${buildCodexMcpServerToml({ entry: entry })}`);
  });

  // Append-only, never parsed: every pre-existing setting — model choice, sandbox policy, the
  // operator's own other MCP servers — must survive byte-for-byte, since this driver has no TOML
  // parser to safely rewrite them with.
  it('preserves unrelated existing sections byte-for-byte', () => {
    const existing = '[model]\nselected = "gpt-5.4"\n\n[mcp_servers.supabase]\ncommand = "npx"\n';
    const result = buildCodexHomeConfigToml({ existingRaw: existing, entry: entry });
    expect(result).toContain(existing);
    expect(result).toContain('[mcp_servers.jini]');
  });

  it('treats an empty existing string the same as undefined', () => {
    expect(buildCodexHomeConfigToml({ existingRaw: '', entry: entry })).toBe(buildCodexMcpServerToml({ entry: entry }));
  });
});

describe('resolveSourceCodexHomeDir', () => {
  it('uses hostEnv.CODEX_HOME when set to a non-blank value', () => {
    expect(resolveSourceCodexHomeDir({ hostEnv: { CODEX_HOME: '/custom/codex-home' } })).toBe('/custom/codex-home');
  });

  it('falls back to ~/.codex when CODEX_HOME is unset', () => {
    expect(resolveSourceCodexHomeDir({ hostEnv: {} })).toBe(path.join(os.homedir(), '.codex'));
  });

  it('treats a blank/whitespace-only CODEX_HOME the same as unset', () => {
    expect(resolveSourceCodexHomeDir({ hostEnv: { CODEX_HOME: '   ' } })).toBe(path.join(os.homedir(), '.codex'));
  });
});

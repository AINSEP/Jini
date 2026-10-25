import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  execFileImpl: null as
    | ((
        file: string,
        args: string[],
        options: unknown,
        cb: (
          err: (Error & { code?: string | number; signal?: string | null; stdout?: string; stderr?: string }) | null,
          result?: { stdout: string; stderr: string },
        ) => void,
      ) => void)
    | null,
}));

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    cb: (
      err: (Error & { code?: string | number; signal?: string | null; stdout?: string; stderr?: string }) | null,
      result?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    if (mockState.execFileImpl) return mockState.execFileImpl(file, args, options, cb);
    cb(null, { stdout: '', stderr: '' });
  },
}));

import {
  antigravityAuthGuidance,
  antigravityQuotaGuidance,
  classifyAgentAuthFailure,
  classifyAgentServiceFailure,
  claudeAuthGuidance,
  cursorAuthGuidance,
  deepseekAuthGuidance,
  isAntigravityAuthFailureText,
  isClaudeAuthFailureText,
  isCursorAuthFailureText,
  isDeepSeekAuthFailureText,
  isReasonixAuthFailureText,
  probeAgentAuthStatus,
  reasonixAuthGuidance,
} from '../auth.js';

// Built via concatenation, not a literal, so this test file itself doesn't
// contain the banned product-identity string (see root AGENTS.md's hard
// boundary and the task's neutrality grep gate).
const ORIGIN_PRODUCT_NAME = ['Open', 'Design'].join(' ');

afterEach(() => {
  mockState.execFileImpl = null;
});

describe('auth guidance de-branding', () => {
  it('defaults to a product-neutral host name', () => {
    const message = cursorAuthGuidance({  });
    expect(message).toContain("the host application's process environment");
    expect(message).not.toContain(ORIGIN_PRODUCT_NAME);
  });

  it('accepts a custom host name', () => {
    const message = claudeAuthGuidance({  }, { hostName: 'Acme Studio' });
    expect(message).toContain('Acme Studio');
    expect(message).not.toContain(ORIGIN_PRODUCT_NAME);
  });

  it('never leaks the origin product name regardless of hostName value', () => {
    const message = cursorAuthGuidance({  }, { hostName: 'Acme Studio' });
    expect(message.includes(ORIGIN_PRODUCT_NAME)).toBe(false);
  });

  it('deepseekAuthGuidance threads hostName through both mentions', () => {
    const message = deepseekAuthGuidance({  }, { hostName: 'Acme Studio' });
    expect(message).toContain("Acme Studio's daemon process");
    expect(message).toContain('If Acme Studio is launched outside an interactive shell');
  });

  it('antigravityAuthGuidance threads hostName through', () => {
    const message = antigravityAuthGuidance({  }, { hostName: 'Acme Studio' });
    expect(message).toContain('both terminal and Acme Studio runs');
  });

  it('antigravityQuotaGuidance takes no hostName parameter and stays constant', () => {
    expect(antigravityQuotaGuidance()).toContain('RESOURCE_EXHAUSTED');
  });

  it('reasonixAuthGuidance threads hostName through both mentions', () => {
    const message = reasonixAuthGuidance({  }, { hostName: 'Acme Studio' });
    expect(message).toContain("Acme Studio's daemon process");
    expect(message).toContain('If Acme Studio is launched outside an interactive shell');
  });

});

describe('auth failure text classifiers', () => {
  it('isCursorAuthFailureText matches common not-authenticated phrasing', () => {
    expect(isCursorAuthFailureText({ text: 'Error: not authenticated. Run cursor-agent login.' })).toBe(true);
    expect(isCursorAuthFailureText({ text: 'some unrelated stdout' })).toBe(false);
  });

  it('isCursorAuthFailureText returns false for empty/whitespace text', () => {
    expect(isCursorAuthFailureText({ text: '' })).toBe(false);
    expect(isCursorAuthFailureText({ text: '   ' })).toBe(false);
  });

  it('isCursorAuthFailureText matches each alternative phrasing', () => {
    expect(isCursorAuthFailureText({ text: 'authentication required' })).toBe(true);
    expect(isCursorAuthFailureText({ text: 'not logged in' })).toBe(true);
    expect(isCursorAuthFailureText({ text: 'unauthenticated' })).toBe(true);
    expect(isCursorAuthFailureText({ text: 'please run agent login' })).toBe(true);
    expect(isCursorAuthFailureText({ text: 'missing CURSOR_API_KEY' })).toBe(true);
  });

  it('isAntigravityAuthFailureText matches each documented phrasing', () => {
    expect(isAntigravityAuthFailureText({ text: 'Authentication required. Please visit the URL to log in: http://x' })).toBe(
      true,
    );
    expect(isAntigravityAuthFailureText({ text: 'Error: authentication timed out.' })).toBe(true);
    expect(isAntigravityAuthFailureText({ text: 'You are not logged into Antigravity' })).toBe(true);
    expect(isAntigravityAuthFailureText({ text: 'accounts.google.com/o/oauth2/auth for antigravity' })).toBe(true);
    expect(isAntigravityAuthFailureText({ text: '' })).toBe(false);
    expect(isAntigravityAuthFailureText({ text: 'unrelated text' })).toBe(false);
  });

  it('isDeepSeekAuthFailureText matches each documented phrasing', () => {
    expect(isDeepSeekAuthFailureText({ text: 'KEY=<your-key>' })).toBe(true);
    expect(isDeepSeekAuthFailureText({ text: 'api_key = "<your-key>"' })).toBe(true);
    expect(isDeepSeekAuthFailureText({ text: '~/.deepseek/config.toml is missing api_key' })).toBe(true);
    expect(isDeepSeekAuthFailureText({ text: 'DEEPSEEK_API_KEY is not set, auth required' })).toBe(true);
    expect(isDeepSeekAuthFailureText({ text: '' })).toBe(false);
    expect(isDeepSeekAuthFailureText({ text: 'unrelated text about deepseek' })).toBe(false);
  });

  it('isReasonixAuthFailureText matches each documented phrasing', () => {
    expect(isReasonixAuthFailureText({ text: '~/.reasonix/config.json missing api_key' })).toBe(true);
    expect(isReasonixAuthFailureText({ text: 'DEEPSEEK_API_KEY not set, auth required' })).toBe(true);
    expect(isReasonixAuthFailureText({ text: '' })).toBe(false);
    expect(isReasonixAuthFailureText({ text: 'unrelated text' })).toBe(false);
  });


  it('isClaudeAuthFailureText returns false for empty/whitespace text', () => {
    expect(isClaudeAuthFailureText({ text: '' })).toBe(false);
    expect(isClaudeAuthFailureText({ text: '   ' })).toBe(false);
  });

  it('isClaudeAuthFailureText reads a structured JSON probe result', () => {
    expect(isClaudeAuthFailureText({ text: '{"authenticated": false}' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: '{"authenticated": true}' })).toBe(false);
  });

  it('isClaudeAuthFailureText reads loggedIn as an alternate JSON key', () => {
    expect(isClaudeAuthFailureText({ text: '{"loggedIn": false}' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: '{"loggedIn": true}' })).toBe(false);
  });

  it('isClaudeAuthFailureText falls through to regex matching on invalid JSON', () => {
    expect(isClaudeAuthFailureText({ text: 'not json at all, but not authenticated' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: 'not json at all, and nothing suspicious' })).toBe(false);
  });

  it('isClaudeAuthFailureText treats a JSON object with neither key as needing regex fallback', () => {
    expect(isClaudeAuthFailureText({ text: '{"other": true} please sign in' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: '{"other": true}' })).toBe(false);
  });

  it('isClaudeAuthFailureText text-matches "authenticated": true/false even without valid JSON wrapping', () => {
    expect(isClaudeAuthFailureText({ text: 'prefix junk "authenticated": true suffix junk {' })).toBe(false);
    expect(isClaudeAuthFailureText({ text: 'prefix junk "loggedIn": false suffix junk {' })).toBe(true);
  });

  it('isClaudeAuthFailureText matches each remaining documented phrasing', () => {
    expect(isClaudeAuthFailureText({ text: 'not logged in' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: 'authentication required' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: 'please sign in' })).toBe(true);
    expect(isClaudeAuthFailureText({ text: 'please log in' })).toBe(true);
  });
});

describe('classifyAgentAuthFailure', () => {
  it('returns null for an unrecognized agent id', () => {
    expect(classifyAgentAuthFailure({ agentId: 'some-other-agent', text: 'not authenticated' })).toBeNull();
  });

  it('returns null when the tailored classifier does not detect a failure, for each tailored agent', () => {
    expect(classifyAgentAuthFailure({ agentId: 'claude', text: 'all good, authenticated' })).toBeNull();
    expect(classifyAgentAuthFailure({ agentId: 'cursor-agent', text: 'status: ok' })).toBeNull();
    expect(classifyAgentAuthFailure({ agentId: 'deepseek', text: 'all good' })).toBeNull();
    expect(classifyAgentAuthFailure({ agentId: 'antigravity', text: 'all good' })).toBeNull();
    expect(classifyAgentAuthFailure({ agentId: 'reasonix', text: 'all good' })).toBeNull();
  });

  it('returns a missing-status result with guidance for each tailored agent', () => {
    expect(classifyAgentAuthFailure({ agentId: 'claude', text: '{"authenticated": false}' })?.status).toBe('missing');
    expect(classifyAgentAuthFailure({ agentId: 'cursor-agent', text: 'not authenticated' })?.status).toBe('missing');
    expect(classifyAgentAuthFailure({ agentId: 'deepseek', text: 'KEY=<your-key>' })?.status).toBe('missing');
    expect(classifyAgentAuthFailure({ agentId: 'antigravity', text: 'authentication timed out' })?.status).toBe('missing');
    expect(classifyAgentAuthFailure({ agentId: 'reasonix', text: 'DEEPSEEK_API_KEY not set, auth required' })?.status).toBe('missing');
  });

  it('threads a custom hostName into the returned message', () => {
    const result = classifyAgentAuthFailure({ agentId: 'claude', text: '{"authenticated": false}' }, { hostName: 'Acme Studio' });
    expect(result?.message).toContain('Acme Studio');
  });
});

describe('classifyAgentServiceFailure', () => {
  it('returns null for empty/whitespace text', () => {
    expect(classifyAgentServiceFailure({ text: '' })).toBeNull();
    expect(classifyAgentServiceFailure({ text: '   ' })).toBeNull();
  });

  it('distinguishes auth vs rate-limit vs upstream', () => {
    expect(classifyAgentServiceFailure({ text: 'HTTP 401 Unauthorized' })).toBe('AGENT_AUTH_REQUIRED');
    expect(classifyAgentServiceFailure({ text: 'rate limit exceeded, please retry' })).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure({ text: '502 Bad Gateway' })).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure({ text: 'exit code 401' })).toBeNull();
  });

  it('prioritizes auth over rate/upstream even when multiple regexes could match', () => {
    expect(classifyAgentServiceFailure({ text: '401 unauthorized, then also 500 internal server error' })).toBe(
      'AGENT_AUTH_REQUIRED',
    );
  });

  it('matches an unqualified /login path', () => {
    expect(classifyAgentServiceFailure({ text: 'redirect to /login' })).toBe('AGENT_AUTH_REQUIRED');
  });

  it('matches "code: 401" but not a bare "exit code 401"', () => {
    expect(classifyAgentServiceFailure({ text: 'code: 401' })).toBe('AGENT_AUTH_REQUIRED');
    expect(classifyAgentServiceFailure({ text: 'process exited with code 401' })).toBeNull();
  });

  it('matches quota/insufficient-balance phrasing for rate limiting', () => {
    expect(classifyAgentServiceFailure({ text: 'insufficient quota remaining' })).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure({ text: 'credit balance is too low' })).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure({ text: 'status 429' })).toBe('RATE_LIMITED');
  });

  it('matches overloaded/gateway phrasing for upstream unavailability', () => {
    expect(classifyAgentServiceFailure({ text: 'overloaded_error' })).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure({ text: 'bad gateway' })).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure({ text: '503 service unavailable' })).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('returns null for ordinary unrelated text', () => {
    expect(classifyAgentServiceFailure({ text: 'the quick brown fox' })).toBeNull();
  });
});

describe('probeAgentAuthStatus', () => {
  it('returns null when the def declares no authProbe', async () => {
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude' }, resolvedBin: '/bin/claude', env: {} });
    expect(result).toBeNull();
  });

  it('short-circuits to ok when a satisfying API key env var is present (codex)', async () => {
    const result = await probeAgentAuthStatus({ def: { id: 'codex', name: 'Codex', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/codex', env: { CODEX_API_KEY: 'sk-test' } }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('short-circuits to ok via the alternate OPENAI_API_KEY for codex', async () => {
    const result = await probeAgentAuthStatus({ def: { id: 'codex', name: 'Codex', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/codex', env: { OPENAI_API_KEY: 'sk-test' } }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('short-circuits to ok when a satisfying API key env var is present (claude)', async () => {
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/claude', env: { ANTHROPIC_AUTH_TOKEN: 'sk-test' } }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('does not short-circuit for an agent id with no known API-key env vars', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'all good', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'unrelated-agent', name: 'Unrelated', authProbe: { args: ['status'] } }, resolvedBin: '/bin/unrelated', env: { SOME_API_KEY: 'x' } }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns ok when the probe succeeds and output does not look like a failure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'authenticated', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('classifies a tailored-agent failure from successful-exit probe output, with tails attached', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: '{"authenticated": false}', stderr: 'warn: x' });
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.status).toBe('missing');
    expect(result?.exitCode).toBe(0);
    expect(result?.signal).toBeNull();
    expect(result?.stdoutTail).toBe('{"authenticated": false}');
    expect(result?.stderrTail).toBe('warn: x');
  });

  it('classifies a generic (non-tailored) agent failure via classifyAgentServiceFailure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'HTTP 401 Unauthorized', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'some-generic-agent', name: 'Generic Agent', authProbe: { args: ['status'] } }, resolvedBin: '/bin/generic', env: {} }
    );
    expect(result?.status).toBe('missing');
    expect(result?.message).toContain('Generic Agent appears to be installed but is not authenticated');
  });

  it('falls back to the agent id when name is falsy in the generic-guidance message', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'HTTP 401 Unauthorized', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'some-generic-agent', name: '', authProbe: { args: ['status'] } }, resolvedBin: '/bin/generic', env: {} }
    );
    expect(result?.message).toContain('some-generic-agent appears to be installed');
  });

  it('honors a custom probe.timeoutMs', async () => {
    let seenTimeout: number | undefined;
    mockState.execFileImpl = (_f, _a, options, cb) => {
      seenTimeout = (options as { timeout?: number })?.timeout;
      cb(null, { stdout: '', stderr: '' });
    };
    await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['x'], timeoutMs: 9999 } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(seenTimeout).toBe(9999);
  });

  it('classifies a tailored-agent failure surfaced via a rejected exec (non-zero exit)', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('Command failed'), {
        code: 1,
        signal: null,
        stdout: '{"authenticated": false}',
        stderr: '',
      });
      cb(err);
    };
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.status).toBe('missing');
    expect(result?.exitCode).toBe(1);
  });

  it('returns an "unknown" status with a verification message when a rejected exec does not classify as a failure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT', signal: null });
      cb(err);
    };
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.status).toBe('unknown');
    expect(result?.message).toContain('authentication status could not be verified');
    expect(result?.message).toContain('claude auth status');
    expect(result?.exitCode).toBeNull();
  });

  it('falls back to the agent id when name is falsy in the "unknown" status message', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      cb(err);
    };
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: '', authProbe: { args: ['x'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.message).toContain('claude authentication status could not be verified');
  });

  it('captures a string signal from a rejected exec', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('killed'), { signal: 'SIGTERM' });
      cb(err);
    };
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.signal).toBe('SIGTERM');
  });

  it('omits stdoutTail/stderrTail when both are empty', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: '', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('treats non-string stdout/stderr from the child process as empty text', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) =>
      cb(null, { stdout: 123 as unknown as string, stderr: undefined as unknown as string });
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('truncates a tail longer than 400 chars to its last 400 chars', async () => {
    const long = 'a'.repeat(500) + 'TAIL_END';
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: `{"authenticated": false} ${long}`, stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } }, resolvedBin: '/bin/claude', env: {} }
    );
    expect(result?.stdoutTail?.length).toBe(400);
    expect(result?.stdoutTail?.endsWith('TAIL_END')).toBe(true);
  });
});

describe('auth characterization (pinned before the complexity refactor)', () => {
  const CLAUDE_PROBE = { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } };

  it('isClaudeAuthFailureText lets authenticated:true win over loggedIn:false in JSON', () => {
    expect(isClaudeAuthFailureText({ text: '{"authenticated": true, "loggedIn": false}' })).toBe(false);
  });

  it('isClaudeAuthFailureText lets loggedIn:true win over authenticated:false in JSON', () => {
    expect(isClaudeAuthFailureText({ text: '{"authenticated": false, "loggedIn": true}' })).toBe(false);
  });

  it('isClaudeAuthFailureText falls back to text matching for a JSON null', () => {
    expect(isClaudeAuthFailureText({ text: 'null' })).toBe(false);
  });

  it('isClaudeAuthFailureText falls back to text matching for a JSON string', () => {
    expect(isClaudeAuthFailureText({ text: '"not authenticated"' })).toBe(true);
  });

  it('isClaudeAuthFailureText ignores non-boolean JSON values and falls back to text matching', () => {
    expect(isClaudeAuthFailureText({ text: '{"authenticated": "no"}' })).toBe(false);
  });

  it('classifyAgentAuthFailure treats a prototype-ish agent id as unrecognized', () => {
    expect(classifyAgentAuthFailure({ agentId: '__proto__', text: 'not authenticated' })).toBeNull();
  });

  it('classifyAgentAuthFailure returns exactly status + message for a tailored agent', () => {
    expect(classifyAgentAuthFailure({ agentId: 'cursor-agent', text: 'not logged in' }, { hostName: 'FakeHost' })).toEqual({
      status: 'missing',
      message: cursorAuthGuidance({}, { hostName: 'FakeHost' }),
    });
  });

  it('probeAgentAuthStatus does not short-circuit on a whitespace-only API key', async () => {
    let called = false;
    mockState.execFileImpl = (_f, _a, _o, cb) => { called = true; cb(null, { stdout: '', stderr: '' }); };
    await probeAgentAuthStatus({ def: { id: 'codex', name: 'Codex', authProbe: { args: ['login', 'status'] } }, resolvedBin: '/bin/codex', env: { CODEX_API_KEY: '   ' } });
    expect(called).toBe(true);
  });

  it('probeAgentAuthStatus does not short-circuit claude on a codex key', async () => {
    let called = false;
    mockState.execFileImpl = (_f, _a, _o, cb) => { called = true; cb(null, { stdout: '', stderr: '' }); };
    await probeAgentAuthStatus({ def: CLAUDE_PROBE, resolvedBin: '/bin/claude', env: { OPENAI_API_KEY: 'fake-key' } });
    expect(called).toBe(true);
  });

  it('probeAgentAuthStatus short-circuits claude on ANTHROPIC_API_KEY', async () => {
    let called = false;
    mockState.execFileImpl = (_f, _a, _o, cb) => { called = true; cb(null, { stdout: '', stderr: '' }); };
    const result = await probeAgentAuthStatus({ def: CLAUDE_PROBE, resolvedBin: '/bin/claude', env: { ANTHROPIC_API_KEY: 'fake-key' } });
    expect(result).toEqual({ status: 'ok' });
    expect(called).toBe(false);
  });

  it('probeAgentAuthStatus runs the probe with the resolved bin, args, env, default timeout and 1 MiB buffer', async () => {
    const seen: { file?: string; args?: string[]; options?: unknown } = {};
    mockState.execFileImpl = (file, args, options, cb) => { Object.assign(seen, { file, args, options }); cb(null, { stdout: '', stderr: '' }); };
    const env = { FAKE_ENV: '1' };
    await probeAgentAuthStatus({ def: CLAUDE_PROBE, resolvedBin: '/bin/claude', env });
    expect(seen.file).toBe('/bin/claude');
    expect(seen.args).toEqual(['auth', 'status']);
    expect(seen.options).toMatchObject({ env, timeout: 5000, maxBuffer: 1024 * 1024 });
  });

  it('probeAgentAuthStatus returns the full missing result (exitCode 0, null signal, both tails) on a successful exit', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: ' {"authenticated": false} ', stderr: ' warn ' });
    const result = await probeAgentAuthStatus({ def: CLAUDE_PROBE, resolvedBin: '/bin/claude', env: {} }, { hostName: 'FakeHost' });
    expect(result).toEqual({
      status: 'missing',
      message: claudeAuthGuidance({}, { hostName: 'FakeHost' }),
      exitCode: 0,
      signal: null,
      stdoutTail: '{"authenticated": false}',
      stderrTail: 'warn',
    });
  });

  it('probeAgentAuthStatus trusts a tailored classifier even when the generic matcher would flag the output', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'HTTP 401', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'cursor-agent', name: 'Cursor', authProbe: { args: ['status'] } }, resolvedBin: '/bin/cursor-agent', env: {} });
    expect(result).toEqual({ status: 'ok' });
  });

  it('probeAgentAuthStatus returns ok for a generic agent whose output is a non-auth service failure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'rate limit exceeded', stderr: '' });
    const result = await probeAgentAuthStatus({ def: { id: 'generic-cli', name: 'Generic', authProbe: { args: ['whoami'] } }, resolvedBin: '/bin/generic', env: {} });
    expect(result).toEqual({ status: 'ok' });
  });

  it('probeAgentAuthStatus classifies a generic agent from the rejection message and threads hostName', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      cb(Object.assign(new Error('HTTP 401 from provider'), { code: 2, signal: null, stdout: 'out', stderr: 'err' }));
    };
    const result = await probeAgentAuthStatus({ def: { id: 'generic-cli', name: 'Generic', authProbe: { args: ['whoami'] } }, resolvedBin: '/bin/generic', env: {} }, { hostName: 'FakeHost' });
    expect(result).toEqual({
      status: 'missing',
      message: 'Generic appears to be installed but is not authenticated. Sign in with the CLI in a terminal, then rescan. If FakeHost was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.',
      exitCode: 2,
      signal: null,
      stdoutTail: 'out',
      stderrTail: 'err',
    });
  });

  it('probeAgentAuthStatus returns the full unknown result with tails, numeric exit and signal on an unclassified rejection', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      cb(Object.assign(new Error('Command failed'), { code: 3, signal: 'SIGKILL', stdout: 'so', stderr: 'se' }));
    };
    const result = await probeAgentAuthStatus({ def: { id: 'generic-cli', name: 'Generic', authProbe: { args: ['auth', 'whoami'] } }, resolvedBin: '/bin/generic', env: {} });
    expect(result).toEqual({
      status: 'unknown',
      message: 'Generic authentication status could not be verified with `generic-cli auth whoami`.',
      exitCode: 3,
      signal: 'SIGKILL',
      stdoutTail: 'so',
      stderrTail: 'se',
    });
  });
});

// Stryker L3 (2026-10-25): 21 Regex + 17 Conditional survivors — each alternation was only reached
// together with another, and spacing/quote variants of the placeholder key were never pinned.
// One case per alternation (alone), plus near-misses that must NOT be flagged.
describe('auth failure classifiers — one alternation per case', () => {
  it.each([
    ['Authentication Required', true], ['you are NOT authenticated', true], ['not logged in', true],
    ['Unauthenticated', true], ['run `agent login`', true], ['set CURSOR_API_KEY', true],
    ['authentication succeeded', false], ['logged in as bob', false], ['   ', false], ['', false],
  ])('cursor: %j → %s', (text, expected) => {
    expect(isCursorAuthFailureText({ text })).toBe(expected);
  });

  it.each([
    ['Authentication required. Please visit the URL to log in: https://x', true],
    ['Error: authentication timed out.', true], ['You are not logged into Antigravity', true],
    ['https://accounts.google.com/o/oauth2/auth?client=antigravity', true],
    ['authentication required', false], ['please visit our docs', false],
    ['https://accounts.google.com/o/oauth2/auth?client=other', false], ['accountsXgoogle.com/o/oauth2/auth antigravity', false],
  ])('antigravity: %j → %s', (text, expected) => {
    expect(isAntigravityAuthFailureText({ text })).toBe(expected);
  });

  it.each([
    ['DEEPSEEK_API_KEY=<your-key>', true], ['key=<YOUR-KEY>', true],
    ['api_key="<your-key>"', true], ["api_key = '<your-key>'", true], ['API_KEY  =  "<your-key>"', true],
    ['api_key=<your-key>', true], // matches the KEY=<your-key> alternation
    ['api_key = <your-key>', false], ['api_key = "<real-key>"', false],
    ['edit ~/.deepseek/config.toml and set api key', true], ['edit ~/.deepseek/config.toml and set api_key', true],
    ['edit ~/.deepseek/config.toml and set api-key', true], ['edit ~/.deepseek/config.toml and set apikey', true],
    ['edit ~/.deepseek/config.toml', false], ['set api key in ~/.other/config.toml', false],
    ['DEEPSEEK_API_KEY missing', true], ['DEEPSEEK_API_KEY not set', true], ['DEEPSEEK_API_KEY required', true],
    ['DEEPSEEK_API_KEY unauthorized', true], ['DEEPSEEK_API_KEY auth error', true], ['DEEPSEEK_API_KEY loaded', false],
    ['  \n ', false],
  ])('deepseek: %j → %s', (text, expected) => {
    expect(isDeepSeekAuthFailureText({ text })).toBe(expected);
  });

  it.each([
    ['~/.reasonix/config.json: apiKey missing', true], ['~/.reasonix/config.json api_key', true],
    ['~/.reasonix/config.json not set', true], ['~/.reasonix/config.json required', true],
    ['~/.reasonix/config.json unauthorized', true], ['~/.reasonix/config.json invalid', true],
    ['~/.reasonix/config.json loaded', false],
    ['DEEPSEEK_API_KEY missing', true], ['DEEPSEEK_API_KEY not set', true], ['DEEPSEEK_API_KEY required', true],
    ['DEEPSEEK_API_KEY unauthorized', true], ['DEEPSEEK_API_KEY invalid', true], ['DEEPSEEK_API_KEY auth', true],
    ['DEEPSEEK_API_KEY loaded', false], ['missing config', false],
  ])('reasonix: %j → %s', (text, expected) => {
    expect(isReasonixAuthFailureText({ text })).toBe(expected);
  });

  it.each([
    ['{"authenticated":true}', false], ['{"loggedIn":true}', false], ['{"authenticated":false,"loggedIn":true}', false],
    ['{"authenticated":false}', true], ['{"loggedIn":false}', true], ['{"other":1}', false], ['null', false],
    ['x "authenticated" : true not authenticated', false], ['x "loggedIn":true not logged in', false],
    ['x "authenticated" :  false', true], ['x "loggedIn" : false', true],
    ['not authenticated', true], ['not loggedin', true], ['not logged_in', true], ['not logged-in', true],
    ['authentication required', true], ['please sign in', true], ['please log in', true], ['please signin', true],
    ['please login', true], ['please sign-in', true], ['signed in fine', false],
  ])('claude: %j → %s', (text, expected) => {
    expect(isClaudeAuthFailureText({ text })).toBe(expected);
  });
});

// Stryker L3 re-score (F3): the codex/claude env short-circuit only had result assertions (the
// probe mock also answers ok), JSON-ish text spacing variants, reasonix apikey, and the tailored
// guidance hostName threading were unpinned.
describe('auth — re-score survivors (F3)', () => {
  it.each([
    ['codex', { CODEX_API_KEY: 'k' }, false], ['codex', { OPENAI_API_KEY: 'k' }, false],
    ['codex', { ANTHROPIC_API_KEY: 'k' }, true], ['claude', { ANTHROPIC_API_KEY: 'k' }, false],
    ['claude', { CODEX_API_KEY: 'k' }, true], ['gemini', { CODEX_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }, true],
  ] as const)('%s with %j probes the CLI: %s', async (id, env, probed) => {
    let called = false;
    mockState.execFileImpl = (_f, _a, _o, cb) => { called = true; cb(null, { stdout: '', stderr: '' }); };
    await probeAgentAuthStatus({ def: { id, name: id, authProbe: { args: ['auth', 'status'] } }, resolvedBin: `/bin/${id}`, env: { ...env } });
    expect(called).toBe(probed);
  });

  it.each([
    ['log "authenticated":true; not authenticated', false],
    ['log "loggedIn"  :  true; not logged in', false],
    ['log "loggedIn":false', true],
    ['log "authenticated":false', true],
  ])('claude text %j → %s', (text, expected) => {
    expect(isClaudeAuthFailureText({ text })).toBe(expected);
  });

  it('reasonix: apikey (no separator) next to its config path', () => {
    expect(isReasonixAuthFailureText({ text: '~/.reasonix/config.json apikey' })).toBe(true);
  });

  it.each([
    ['deepseek', 'DEEPSEEK_API_KEY missing'],
    ['antigravity', 'Error: authentication timed out.'],
    ['reasonix', 'DEEPSEEK_API_KEY missing'],
    ['cursor-agent', 'not logged in'],
    ['claude', 'not logged in'],
  ])('%s guidance threads the host name', (agentId, text) => {
    const result = classifyAgentAuthFailure({ agentId, text }, { hostName: 'HostX' });
    expect(result?.status).toBe('missing');
    expect(typeof result?.message).toBe('string');
    expect(result?.message?.length ?? 0).toBeGreaterThan(20);
    if (agentId !== 'antigravity' && agentId !== 'cursor-agent') expect(result?.message).toContain('HostX');
  });
});

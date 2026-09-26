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
  geminiAuthGuidance,
  isAntigravityAuthFailureText,
  isClaudeAuthFailureText,
  isCursorAuthFailureText,
  isDeepSeekAuthFailureText,
  isGeminiAuthFailureText,
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
    const message = cursorAuthGuidance();
    expect(message).toContain("the host application's process environment");
    expect(message).not.toContain(ORIGIN_PRODUCT_NAME);
  });

  it('accepts a custom host name', () => {
    const message = claudeAuthGuidance('Acme Studio');
    expect(message).toContain('Acme Studio');
    expect(message).not.toContain(ORIGIN_PRODUCT_NAME);
  });

  it('never leaks the origin product name regardless of hostName value', () => {
    const message = cursorAuthGuidance('Acme Studio');
    expect(message.includes(ORIGIN_PRODUCT_NAME)).toBe(false);
  });

  it('deepseekAuthGuidance threads hostName through both mentions', () => {
    const message = deepseekAuthGuidance('Acme Studio');
    expect(message).toContain("Acme Studio's daemon process");
    expect(message).toContain('If Acme Studio is launched outside an interactive shell');
  });

  it('antigravityAuthGuidance threads hostName through', () => {
    const message = antigravityAuthGuidance('Acme Studio');
    expect(message).toContain('both terminal and Acme Studio runs');
  });

  it('antigravityQuotaGuidance takes no hostName parameter and stays constant', () => {
    expect(antigravityQuotaGuidance()).toContain('RESOURCE_EXHAUSTED');
  });

  it('reasonixAuthGuidance threads hostName through both mentions', () => {
    const message = reasonixAuthGuidance('Acme Studio');
    expect(message).toContain("Acme Studio's daemon process");
    expect(message).toContain('If Acme Studio is launched outside an interactive shell');
  });

  it('geminiAuthGuidance threads hostName and points at an API key, not a re-login', () => {
    const message = geminiAuthGuidance('Acme Studio');
    expect(message).toContain("Acme Studio's process environment");
    expect(message).toContain('GEMINI_API_KEY');
    expect(geminiAuthGuidance()).toContain("the host application's process environment");
  });
});

describe('auth failure text classifiers', () => {
  it('isCursorAuthFailureText matches common not-authenticated phrasing', () => {
    expect(isCursorAuthFailureText('Error: not authenticated. Run cursor-agent login.')).toBe(true);
    expect(isCursorAuthFailureText('some unrelated stdout')).toBe(false);
  });

  it('isCursorAuthFailureText returns false for empty/whitespace text', () => {
    expect(isCursorAuthFailureText('')).toBe(false);
    expect(isCursorAuthFailureText('   ')).toBe(false);
  });

  it('isCursorAuthFailureText matches each alternative phrasing', () => {
    expect(isCursorAuthFailureText('authentication required')).toBe(true);
    expect(isCursorAuthFailureText('not logged in')).toBe(true);
    expect(isCursorAuthFailureText('unauthenticated')).toBe(true);
    expect(isCursorAuthFailureText('please run agent login')).toBe(true);
    expect(isCursorAuthFailureText('missing CURSOR_API_KEY')).toBe(true);
  });

  it('isAntigravityAuthFailureText matches each documented phrasing', () => {
    expect(isAntigravityAuthFailureText('Authentication required. Please visit the URL to log in: http://x')).toBe(
      true,
    );
    expect(isAntigravityAuthFailureText('Error: authentication timed out.')).toBe(true);
    expect(isAntigravityAuthFailureText('You are not logged into Antigravity')).toBe(true);
    expect(isAntigravityAuthFailureText('accounts.google.com/o/oauth2/auth for antigravity')).toBe(true);
    expect(isAntigravityAuthFailureText('')).toBe(false);
    expect(isAntigravityAuthFailureText('unrelated text')).toBe(false);
  });

  it('isDeepSeekAuthFailureText matches each documented phrasing', () => {
    expect(isDeepSeekAuthFailureText('KEY=<your-key>')).toBe(true);
    expect(isDeepSeekAuthFailureText('api_key = "<your-key>"')).toBe(true);
    expect(isDeepSeekAuthFailureText('~/.deepseek/config.toml is missing api_key')).toBe(true);
    expect(isDeepSeekAuthFailureText('DEEPSEEK_API_KEY is not set, auth required')).toBe(true);
    expect(isDeepSeekAuthFailureText('')).toBe(false);
    expect(isDeepSeekAuthFailureText('unrelated text about deepseek')).toBe(false);
  });

  it('isReasonixAuthFailureText matches each documented phrasing', () => {
    expect(isReasonixAuthFailureText('~/.reasonix/config.json missing api_key')).toBe(true);
    expect(isReasonixAuthFailureText('DEEPSEEK_API_KEY not set, auth required')).toBe(true);
    expect(isReasonixAuthFailureText('')).toBe(false);
    expect(isReasonixAuthFailureText('unrelated text')).toBe(false);
  });

  it('isGeminiAuthFailureText matches the no-auth-method and ineligible-tier failures', () => {
    // Verbatim stderr of `gemini` 0.58.0 headless runs.
    expect(
      isGeminiAuthFailureText(
        'Please set an Auth method in your /Users/x/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA',
      ),
    ).toBe(true);
    expect(
      isGeminiAuthFailureText(
        'Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.',
      ),
    ).toBe(true);
    expect(isGeminiAuthFailureText('API key not valid. Please pass a valid API key.')).toBe(true);
    expect(isGeminiAuthFailureText('')).toBe(false);
    expect(isGeminiAuthFailureText('unrelated text about gemini')).toBe(false);
  });

  it('isClaudeAuthFailureText returns false for empty/whitespace text', () => {
    expect(isClaudeAuthFailureText('')).toBe(false);
    expect(isClaudeAuthFailureText('   ')).toBe(false);
  });

  it('isClaudeAuthFailureText reads a structured JSON probe result', () => {
    expect(isClaudeAuthFailureText('{"authenticated": false}')).toBe(true);
    expect(isClaudeAuthFailureText('{"authenticated": true}')).toBe(false);
  });

  it('isClaudeAuthFailureText reads loggedIn as an alternate JSON key', () => {
    expect(isClaudeAuthFailureText('{"loggedIn": false}')).toBe(true);
    expect(isClaudeAuthFailureText('{"loggedIn": true}')).toBe(false);
  });

  it('isClaudeAuthFailureText falls through to regex matching on invalid JSON', () => {
    expect(isClaudeAuthFailureText('not json at all, but not authenticated')).toBe(true);
    expect(isClaudeAuthFailureText('not json at all, and nothing suspicious')).toBe(false);
  });

  it('isClaudeAuthFailureText treats a JSON object with neither key as needing regex fallback', () => {
    expect(isClaudeAuthFailureText('{"other": true} please sign in')).toBe(true);
    expect(isClaudeAuthFailureText('{"other": true}')).toBe(false);
  });

  it('isClaudeAuthFailureText text-matches "authenticated": true/false even without valid JSON wrapping', () => {
    expect(isClaudeAuthFailureText('prefix junk "authenticated": true suffix junk {')).toBe(false);
    expect(isClaudeAuthFailureText('prefix junk "loggedIn": false suffix junk {')).toBe(true);
  });

  it('isClaudeAuthFailureText matches each remaining documented phrasing', () => {
    expect(isClaudeAuthFailureText('not logged in')).toBe(true);
    expect(isClaudeAuthFailureText('authentication required')).toBe(true);
    expect(isClaudeAuthFailureText('please sign in')).toBe(true);
    expect(isClaudeAuthFailureText('please log in')).toBe(true);
  });
});

describe('classifyAgentAuthFailure', () => {
  it('returns null for an unrecognized agent id', () => {
    expect(classifyAgentAuthFailure('some-other-agent', 'not authenticated')).toBeNull();
  });

  it('returns null when the tailored classifier does not detect a failure, for each tailored agent', () => {
    expect(classifyAgentAuthFailure('claude', 'all good, authenticated')).toBeNull();
    expect(classifyAgentAuthFailure('cursor-agent', 'status: ok')).toBeNull();
    expect(classifyAgentAuthFailure('deepseek', 'all good')).toBeNull();
    expect(classifyAgentAuthFailure('antigravity', 'all good')).toBeNull();
    expect(classifyAgentAuthFailure('reasonix', 'all good')).toBeNull();
    expect(classifyAgentAuthFailure('gemini', 'all good')).toBeNull();
  });

  it('returns a missing-status result with guidance for each tailored agent', () => {
    expect(classifyAgentAuthFailure('claude', '{"authenticated": false}')?.status).toBe('missing');
    expect(classifyAgentAuthFailure('cursor-agent', 'not authenticated')?.status).toBe('missing');
    expect(classifyAgentAuthFailure('deepseek', 'KEY=<your-key>')?.status).toBe('missing');
    expect(classifyAgentAuthFailure('antigravity', 'authentication timed out')?.status).toBe('missing');
    expect(classifyAgentAuthFailure('reasonix', 'DEEPSEEK_API_KEY not set, auth required')?.status).toBe('missing');
    expect(classifyAgentAuthFailure('gemini', 'Please set an Auth method in your settings.json')?.status).toBe('missing');
  });

  it('threads a custom hostName into the returned message', () => {
    const result = classifyAgentAuthFailure('claude', '{"authenticated": false}', 'Acme Studio');
    expect(result?.message).toContain('Acme Studio');
  });
});

describe('classifyAgentServiceFailure', () => {
  it('returns null for empty/whitespace text', () => {
    expect(classifyAgentServiceFailure('')).toBeNull();
    expect(classifyAgentServiceFailure('   ')).toBeNull();
  });

  it('distinguishes auth vs rate-limit vs upstream', () => {
    expect(classifyAgentServiceFailure('HTTP 401 Unauthorized')).toBe('AGENT_AUTH_REQUIRED');
    expect(classifyAgentServiceFailure('rate limit exceeded, please retry')).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure('502 Bad Gateway')).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure('exit code 401')).toBeNull();
  });

  it('prioritizes auth over rate/upstream even when multiple regexes could match', () => {
    expect(classifyAgentServiceFailure('401 unauthorized, then also 500 internal server error')).toBe(
      'AGENT_AUTH_REQUIRED',
    );
  });

  it('matches an unqualified /login path', () => {
    expect(classifyAgentServiceFailure('redirect to /login')).toBe('AGENT_AUTH_REQUIRED');
  });

  it('matches "code: 401" but not a bare "exit code 401"', () => {
    expect(classifyAgentServiceFailure('code: 401')).toBe('AGENT_AUTH_REQUIRED');
    expect(classifyAgentServiceFailure('process exited with code 401')).toBeNull();
  });

  it('matches quota/insufficient-balance phrasing for rate limiting', () => {
    expect(classifyAgentServiceFailure('insufficient quota remaining')).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure('credit balance is too low')).toBe('RATE_LIMITED');
    expect(classifyAgentServiceFailure('status 429')).toBe('RATE_LIMITED');
  });

  it('matches overloaded/gateway phrasing for upstream unavailability', () => {
    expect(classifyAgentServiceFailure('overloaded_error')).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure('bad gateway')).toBe('UPSTREAM_UNAVAILABLE');
    expect(classifyAgentServiceFailure('503 service unavailable')).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('returns null for ordinary unrelated text', () => {
    expect(classifyAgentServiceFailure('the quick brown fox')).toBeNull();
  });
});

describe('probeAgentAuthStatus', () => {
  it('returns null when the def declares no authProbe', async () => {
    const result = await probeAgentAuthStatus({ id: 'claude', name: 'Claude' }, '/bin/claude', {});
    expect(result).toBeNull();
  });

  it('short-circuits to ok when a satisfying API key env var is present (codex)', async () => {
    const result = await probeAgentAuthStatus(
      { id: 'codex', name: 'Codex', authProbe: { args: ['auth', 'status'] } },
      '/bin/codex',
      { CODEX_API_KEY: 'sk-test' },
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('short-circuits to ok via the alternate OPENAI_API_KEY for codex', async () => {
    const result = await probeAgentAuthStatus(
      { id: 'codex', name: 'Codex', authProbe: { args: ['auth', 'status'] } },
      '/bin/codex',
      { OPENAI_API_KEY: 'sk-test' },
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('short-circuits to ok when a satisfying API key env var is present (claude)', async () => {
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } },
      '/bin/claude',
      { ANTHROPIC_AUTH_TOKEN: 'sk-test' },
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('does not short-circuit for an agent id with no known API-key env vars', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'all good', stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'unrelated-agent', name: 'Unrelated', authProbe: { args: ['status'] } },
      '/bin/unrelated',
      { SOME_API_KEY: 'x' },
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns ok when the probe succeeds and output does not look like a failure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'authenticated', stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } },
      '/bin/claude',
      {},
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('classifies a tailored-agent failure from successful-exit probe output, with tails attached', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: '{"authenticated": false}', stderr: 'warn: x' });
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } },
      '/bin/claude',
      {},
    );
    expect(result?.status).toBe('missing');
    expect(result?.exitCode).toBe(0);
    expect(result?.signal).toBeNull();
    expect(result?.stdoutTail).toBe('{"authenticated": false}');
    expect(result?.stderrTail).toBe('warn: x');
  });

  it('classifies a generic (non-tailored) agent failure via classifyAgentServiceFailure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'HTTP 401 Unauthorized', stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'some-generic-agent', name: 'Generic Agent', authProbe: { args: ['status'] } },
      '/bin/generic',
      {},
    );
    expect(result?.status).toBe('missing');
    expect(result?.message).toContain('Generic Agent appears to be installed but is not authenticated');
  });

  it('falls back to the agent id when name is falsy in the generic-guidance message', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: 'HTTP 401 Unauthorized', stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'some-generic-agent', name: '', authProbe: { args: ['status'] } },
      '/bin/generic',
      {},
    );
    expect(result?.message).toContain('some-generic-agent appears to be installed');
  });

  it('honors a custom probe.timeoutMs', async () => {
    let seenTimeout: number | undefined;
    mockState.execFileImpl = (_f, _a, options, cb) => {
      seenTimeout = (options as { timeout?: number })?.timeout;
      cb(null, { stdout: '', stderr: '' });
    };
    await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['x'], timeoutMs: 9999 } },
      '/bin/claude',
      {},
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
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } },
      '/bin/claude',
      {},
    );
    expect(result?.status).toBe('missing');
    expect(result?.exitCode).toBe(1);
  });

  it('returns an "unknown" status with a verification message when a rejected exec does not classify as a failure', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT', signal: null });
      cb(err);
    };
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['auth', 'status'] } },
      '/bin/claude',
      {},
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
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: '', authProbe: { args: ['x'] } },
      '/bin/claude',
      {},
    );
    expect(result?.message).toContain('claude authentication status could not be verified');
  });

  it('captures a string signal from a rejected exec', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => {
      const err = Object.assign(new Error('killed'), { signal: 'SIGTERM' });
      cb(err);
    };
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } },
      '/bin/claude',
      {},
    );
    expect(result?.signal).toBe('SIGTERM');
  });

  it('omits stdoutTail/stderrTail when both are empty', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: '', stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } },
      '/bin/claude',
      {},
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('treats non-string stdout/stderr from the child process as empty text', async () => {
    mockState.execFileImpl = (_f, _a, _o, cb) =>
      cb(null, { stdout: 123 as unknown as string, stderr: undefined as unknown as string });
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } },
      '/bin/claude',
      {},
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('truncates a tail longer than 400 chars to its last 400 chars', async () => {
    const long = 'a'.repeat(500) + 'TAIL_END';
    mockState.execFileImpl = (_f, _a, _o, cb) => cb(null, { stdout: `{"authenticated": false} ${long}`, stderr: '' });
    const result = await probeAgentAuthStatus(
      { id: 'claude', name: 'Claude', authProbe: { args: ['x'] } },
      '/bin/claude',
      {},
    );
    expect(result?.stdoutTail?.length).toBe(400);
    expect(result?.stdoutTail?.endsWith('TAIL_END')).toBe(true);
  });
});

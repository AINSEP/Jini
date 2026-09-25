import { describe, expect, it } from 'vitest';
import { antigravityAgentDef, parseAgyModels, redactAntigravityAuthUrls } from '../antigravity.js';

describe('antigravityAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(antigravityAgentDef.id).toBe('antigravity');
    expect(antigravityAgentDef.bin).toBe('agy');
    expect(antigravityAgentDef.supportsCustomModel).toBe(false);
    // agy has no stdin prompt path under its default `--input-format text`;
    // the prompt rides argv as `-p`'s value, so this def must stay
    // argv-budgeted. If `promptViaStdin` ever comes back, the driver stops
    // putting the prompt where the CLI actually reads it.
    expect('promptViaStdin' in antigravityAgentDef).toBe(false);
    expect(antigravityAgentDef.maxPromptArgBytes).toBe(30_000);
    expect(antigravityAgentDef.streamFormat).toBe('plain');
    expect(antigravityAgentDef.fallbackModels[0]?.id).toBe('default');
  });

  // `agy models` gives this def a live catalog (unlike the old fallback-only
  // list) — 10s rather than codex's 5s because it does a real network fetch
  // (its own stdout announces "Fetching available models...").
  it('declares a live listModels probe backed by parseAgyModels', () => {
    expect(antigravityAgentDef.listModels).toEqual({
      args: ['models'],
      parse: parseAgyModels,
      timeoutMs: 10_000,
    });
  });

  // `agy` passes its own parent process env through to the stdio MCP children it spawns for
  // servers already sitting in its persistent global registry — verified live (see this def's own
  // doc). That makes a one-time, out-of-band global registration a real, safe delivery mechanism,
  // reversing the prior "no safe run-scoped mechanism" verdict this field used to encode as
  // `undefined`.
  it('declares the env-passthrough external MCP injection strategy', () => {
    expect(antigravityAgentDef.externalMcpInjection).toBe('env-passthrough');
  });

  // The two fields that make a generic driver able to run agy at all — see
  // packages/daemon/src/agent-executor.ts's "Antigravity's two extra needs,
  // met declaratively" section. Pinned here because a driver reads them by
  // name: silently dropping one degrades to a live-streaming, log-less run
  // that leaks a sign-in URL, with nothing failing loudly. There is no
  // `runtimeLock` here any more — `--model` (see the `buildArgs` tests
  // below) replaced the settings.json-write-then-poll-the-log mechanism the
  // lock used to serialize.
  it('opts into a staged log file and buffered+sanitized stdout, and declares no runtimeLock', () => {
    expect(antigravityAgentDef.needsAgentLogFile).toBe(true);
    expect(antigravityAgentDef.stdoutPolicy.buffering).toBe('until-close');
    expect(antigravityAgentDef.stdoutPolicy.sanitize).toBe(redactAntigravityAuthUrls);
    expect('runtimeLock' in antigravityAgentDef).toBe(false);
  });
});

describe('redactAntigravityAuthUrls', () => {
  // The exact stdout agy v1.0.3 prints (and exits 0 on) when its keyring entry
  // is missing — the same text `auth.ts`'s isAntigravityAuthFailureText
  // classifies, and the same fixture OD's own chat-route test used.
  const REAL_AUTH_PROMPT =
    'Authentication required. Please visit the URL to log in: https://accounts.google.com/o/oauth2/auth?client_id=12345&redirect_uri=antigravity-redirect\n' +
    'Waiting for authentication (timeout 30s)...\n' +
    'Error: authentication timed out.\n';

  it('removes the real agy sign-in URL while keeping the surrounding text', () => {
    const redacted = redactAntigravityAuthUrls(REAL_AUTH_PROMPT);
    expect(redacted).not.toContain('accounts.google.com');
    expect(redacted).not.toContain('client_id=12345');
    expect(redacted).not.toContain('antigravity-redirect');
    expect(redacted).toContain('Authentication required. Please visit the URL to log in: [redacted sign-in URL]');
    // The non-URL diagnostic lines are still useful and still forwarded.
    expect(redacted).toContain('Error: authentication timed out.');
  });

  it('redacts every occurrence, not just the first', () => {
    const redacted = redactAntigravityAuthUrls(
      'first https://accounts.google.com/o/oauth2/auth?a=1 then https://accounts.google.com/o/oauth2/auth?b=2 end',
    );
    expect(redacted).toBe('first [redacted sign-in URL] then [redacted sign-in URL] end');
  });

  it('redacts a non-Google URL that still carries OAuth/credential query parameters', () => {
    // Degrades to "redacted" rather than "leaked" if upstream ever moves off
    // accounts.google.com.
    for (const param of ['client_id', 'code_challenge', 'code_verifier', 'access_token', 'id_token', 'refresh_token']) {
      expect(redactAntigravityAuthUrls(`go to https://login.example.test/authorize?${param}=abc123`)).toBe(
        'go to [redacted sign-in URL]',
      );
    }
  });

  it('leaves ordinary assistant output — including ordinary links — byte-identical', () => {
    const ordinary =
      'Here is the fix. See the docs at https://example.test/guide/auth-setup and\n' +
      'the Google Cloud console at https://console.cloud.google.com/apis.\n' +
      'The client identifier is configured server-side.\n';
    expect(redactAntigravityAuthUrls(ordinary)).toBe(ordinary);
  });

  it('returns empty text unchanged', () => {
    expect(redactAntigravityAuthUrls('')).toBe('');
  });
});

describe('parseAgyModels', () => {
  // Real `agy models` stdout as of agy v1.1.24 (captured live, 2026-09-02):
  // one progress line, then one `<slug>\t<label>` pair per line.
  const REAL_STDOUT =
    'Fetching available models...\n' +
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n' +
    'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n' +
    'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n' +
    'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n' +
    'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)\n' +
    'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n' +
    'gemini-3.6-flash-high\tGemini 3.6 Flash (High)\n' +
    'gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)\n' +
    'gemini-3.6-flash-low\tGemini 3.6 Flash (Low)\n' +
    'gemini-3.1-pro-high\tGemini 3.1 Pro (High)\n' +
    'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)\n' +
    'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n' +
    'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n' +
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n';

  it('drops the leading progress line and parses all 14 real entries', () => {
    const result = parseAgyModels(REAL_STDOUT);
    expect(result?.map((m) => m.id)).toEqual([
      'default',
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
      'gemini-3.7-flash-high',
      'gemini-3.7-flash-medium',
      'gemini-3.7-flash-low',
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.6-flash-low',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ]);
  });

  it('splits id and label on the first tab, matching agy\'s real labels verbatim', () => {
    const result = parseAgyModels(REAL_STDOUT);
    expect(result?.find((m) => m.id === 'gemini-3.1-pro-high')).toEqual({
      id: 'gemini-3.1-pro-high',
      label: 'Gemini 3.1 Pro (High)',
    });
    expect(result?.find((m) => m.id === 'claude-opus-4-6-thinking')).toEqual({
      id: 'claude-opus-4-6-thinking',
      label: 'Claude Opus 4.6 (Thinking)',
    });
  });

  it('drops the progress line case-insensitively regardless of surrounding whitespace', () => {
    const result = parseAgyModels('  Fetching Available Models...  \nfoo\tFoo Label\n');
    expect(result?.map((m) => m.id)).toEqual(['default', 'foo']);
  });

  it('splits on the FIRST tab only, so a label containing extra tabs is preserved intact and never bleeds into the id', () => {
    const result = parseAgyModels('gemini-3.1-pro-high\tGemini 3.1 Pro\t(High)\textra\n');
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro\t(High)\textra' },
    ]);
  });

  it('trims surrounding whitespace from both id and label without corrupting either', () => {
    const result = parseAgyModels('  gemini-3.1-pro-high  \t   Gemini 3.1 Pro (High)   \n');
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    ]);
  });

  it('skips a line with no tab at all rather than mis-parsing it', () => {
    const result = parseAgyModels('Fetching available models...\nno-tab-here\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\n');
    expect(result?.map((m) => m.id)).toEqual(['default', 'gemini-3.1-pro-high']);
  });

  it('de-duplicates a repeated id, keeping the first occurrence', () => {
    const result = parseAgyModels('foo\tFirst\nfoo\tSecond\n');
    expect(result?.filter((m) => m.id === 'foo')).toHaveLength(1);
    expect(result?.find((m) => m.id === 'foo')?.label).toBe('First');
  });

  it('returns null for empty stdout, so detection.ts falls back rather than showing an empty picker', () => {
    expect(parseAgyModels('')).toBeNull();
  });

  it('returns null for whitespace-only stdout', () => {
    expect(parseAgyModels('   \n  \n')).toBeNull();
  });

  it('returns null when stdout is only the progress line (offline/errored fetch never yielded a real entry)', () => {
    expect(parseAgyModels('Fetching available models...\n')).toBeNull();
  });
});

describe('antigravityAgentDef.listModels.parse', () => {
  it('delegates to parseAgyModels for real output', () => {
    const result = antigravityAgentDef.listModels!.parse('gemini-3.1-pro-high\tGemini 3.1 Pro (High)\n');
    expect(result).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    ]);
  });

  it('returns null for blank stdout', () => {
    expect(antigravityAgentDef.listModels!.parse('   ')).toBeNull();
  });
});

describe('antigravityAgentDef.buildArgs', () => {
  // The regression this whole describe block exists for: `-p` is a Go
  // flag-package flag whose VALUE is the prompt. The previous argv was
  // `['-p', '-']` — a literal one-character prompt of `-` — which agy ran
  // happily (exit 0) while never reading the real prompt, so every turn came
  // back as a generic "How can I assist you today?" greeting sourced from
  // agy's own project memory instead of an answer. Asserting the prompt is
  // present in argv is what makes that failure visible from a unit test.
  it('passes the prompt as the value of -p', () => {
    const args = antigravityAgentDef.buildArgs('Reply with PONG', [], [], {}, {});
    expect(args).toEqual(['-p', 'Reply with PONG']);
  });

  it('never emits a bare `-` stdin sentinel in place of the prompt', () => {
    const args = antigravityAgentDef.buildArgs('Reply with PONG', [], [], {}, {
      agentLogFilePath: '/tmp/agy.log',
    });
    expect(args).not.toContain('-');
    expect(args[args.indexOf('-p') + 1]).toBe('Reply with PONG');
  });

  it('keeps a multi-line transcript prompt intact as a single argv entry', () => {
    const transcript = 'user: first\n\nassistant: second\n\nuser: third';
    const args = antigravityAgentDef.buildArgs(transcript, [], [], {}, {});
    expect(args).toEqual(['-p', transcript]);
  });

  // The regression this describe block gained when the settings.json/lock mechanism was retired:
  // a concrete model must reach agy as the value of a real `--model` flag, not as a side-effect
  // file write. `--model` is a Go flag whose value is the immediately-following argv token — the
  // same shape as `-p` and `--log-file` above — so it must precede `-p` (always last).
  it('emits --model <id> before -p when a concrete model is chosen', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], { model: 'gemini-3.1-pro-high' }, {});
    expect(args).toEqual(['--model', 'gemini-3.1-pro-high', '-p', 'hi']);
  });

  it('omits --model when options.model is the "default" sentinel', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], { model: 'default' }, {});
    expect(args).toEqual(['-p', 'hi']);
  });

  it('omits --model when options.model is falsy/absent', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).toEqual(['-p', 'hi']);
  });

  // Order matters for real: everything after `-p` is consumed as its value,
  // so `--log-file` has to come first or the log path becomes part of the
  // prompt and the diagnostic log is never written.
  it('prepends --log-file <path> before -p when agentLogFilePath is set', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {}, { agentLogFilePath: '/tmp/agy.log' });
    expect(args).toEqual(['--log-file', '/tmp/agy.log', '-p', 'hi']);
  });

  it('omits --log-file entirely when agentLogFilePath is absent', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).toEqual(['-p', 'hi']);
  });

  // Both extra flags precede -p together, in the order buildArgs itself pushes them
  // (--model, then --log-file) — pinned so a future edit that reorders the pushes has to
  // consciously re-decide this, not silently flip it.
  it('emits --model then --log-file, both before -p, when both are present', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], { model: 'claude-opus-4-6-thinking' }, {
      agentLogFilePath: '/tmp/agy.log',
    });
    expect(args).toEqual(['--model', 'claude-opus-4-6-thinking', '--log-file', '/tmp/agy.log', '-p', 'hi']);
  });

  // agy resumes a prior conversation only when explicitly asked
  // (`-c`/`--continue`, or `--conversation <id>`). Never emitting either is
  // what keeps each Runner-initiated turn a genuinely fresh conversation.
  it('never asks agy to continue or resume a conversation', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], { model: 'gemini-3.1-pro-high' }, {
      agentLogFilePath: '/tmp/agy.log',
    });
    for (const resumeFlag of ['-c', '--continue', '--conversation']) {
      expect(args).not.toContain(resumeFlag);
    }
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    expect(() => antigravityAgentDef.buildArgs('hi', [])).not.toThrow();
  });
});

describe('antigravityAgentDef reasoning-effort declaration', () => {
  // agy has NO effort flag: `agy --help` exposes `--model` and nothing that
  // takes a reasoning level. Effort is encoded as a trailing `-<level>` on the
  // model slug itself (`gemini-3.1-pro-high`), so this def declares the
  // suffix VOCABULARY and lets the picker derive which levels each base model
  // actually has from the live `agy models` list. Declaring a flat
  // `reasoningOptions` here instead would be a lie: it would offer
  // `gemini-3.1-pro-medium`, which does not exist and which `agy --model`
  // rejects outright.
  it('declares reasoning-in-model-id with exactly the three recognized suffixes', () => {
    expect(antigravityAgentDef.reasoningInModelId?.levels).toEqual([
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low', label: 'Low' },
    ]);
  });

  // Mutually exclusive with `reasoningOptions` on purpose — a def carrying
  // both would render two effort controls that disagree about where the
  // choice goes.
  it('declares no flat reasoningOptions, because the effort rides in the model id', () => {
    expect('reasoningOptions' in antigravityAgentDef).toBe(false);
  });

  it('emits no extra argv for a reasoning selection — the effort is already inside --model', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {
      model: 'gemini-3.1-pro-high',
      reasoning: 'high',
    });
    expect(args).toEqual(['--model', 'gemini-3.1-pro-high', '-p', 'hi']);
    expect(args.join(' ')).not.toContain('--effort');
    expect(args.join(' ')).not.toContain('reasoning');
  });
});

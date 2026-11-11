import { describe, expect, it } from 'vitest';
import {
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
} from '../prompt-budget.js';
import type { RuntimeAgentDef } from '../types.js';

function makeDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    bin: 'test-agent',
    versionArgs: [],
    buildArgs: () => [],
    fallbackModels: [],
    streamFormat: 'plain',
    ...overrides,
  } as RuntimeAgentDef;
}

describe('checkPromptArgvBudget', () => {
  it('returns null when def is nullish', () => {
    expect(checkPromptArgvBudget({ def: null, composed: 'x' })).toBeNull();
    expect(checkPromptArgvBudget({ def: undefined, composed: 'x' })).toBeNull();
  });

  it('returns null when the def does not declare maxPromptArgBytes', () => {
    const def = makeDef();
    expect(checkPromptArgvBudget({ def: def, composed: 'x'.repeat(1_000_000) })).toBeNull();
  });

  it('returns null when the composed prompt is within budget', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkPromptArgvBudget({ def: def, composed: 'short prompt' }, { platform: 'darwin' })).toBeNull();
  });

  it('treats a non-string composed value as zero bytes', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkPromptArgvBudget({ def: def, composed: { not: 'a string' } }, { platform: 'darwin' })).toBeNull();
  });

  it('flags an oversized prompt on POSIX using the 100_000-byte floor even when maxPromptArgBytes is smaller', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    const prompt = 'x'.repeat(100_001);
    const error = checkPromptArgvBudget({ def: def, composed: prompt }, { platform: 'linux' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('AGENT_PROMPT_TOO_LARGE');
    expect(error?.limit).toBe(100_000);
    expect(error?.bytes).toBe(100_001);
  });

  it('uses maxPromptArgBytes directly (no POSIX floor) on win32', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    const prompt = 'x'.repeat(101);
    const error = checkPromptArgvBudget({ def: def, composed: prompt }, { platform: 'win32' });
    expect(error).not.toBeNull();
    expect(error?.limit).toBe(100);
  });

  it('respects a maxPromptArgBytes larger than the POSIX floor', () => {
    const def = makeDef({ maxPromptArgBytes: 200_000 });
    const prompt = 'x'.repeat(150_000);
    expect(checkPromptArgvBudget({ def: def, composed: prompt }, { platform: 'linux' })).toBeNull();
  });

  it('uses process.platform when no platform argument is supplied', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    // Whatever the current platform is, a short prompt must stay within budget.
    expect(checkPromptArgvBudget({ def: def, composed: 'short' })).toBeNull();
  });

  it('produces DeepSeek-specific guidance copy for the deepseek agent id', () => {
    const def = makeDef({ id: 'deepseek', maxPromptArgBytes: 10 });
    const error = checkPromptArgvBudget({ def: def, composed: 'x'.repeat(100_001) }, { platform: 'linux' });
    expect(error?.message).toContain('currently accepts prompts only as a command-line argument');
    expect(error?.message).toContain('use DeepSeek through an API/provider model connection');
  });

  it('produces the generic guidance copy for a non-deepseek agent id', () => {
    const def = makeDef({ id: 'some-other-agent', maxPromptArgBytes: 10 });
    const error = checkPromptArgvBudget({ def: def, composed: 'x'.repeat(100_001) }, { platform: 'linux' });
    expect(error?.message).toContain('requires the prompt as a command-line argument');
    expect(error?.message).not.toContain('DeepSeek through an API/provider');
  });
});

describe('checkWindowsCmdShimCommandLineBudget', () => {
  it('returns null when def is nullish', () => {
    expect(checkWindowsCmdShimCommandLineBudget({ def: null, resolvedBin: 'C:\\deepseek.cmd', args: [] })).toBeNull();
  });

  it('returns null when the def does not declare maxPromptArgBytes', () => {
    const def = makeDef();
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: ['x'.repeat(50_000)] })).toBeNull();
  });

  it('returns null when resolvedBin is not a string', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: undefined, args: [] })).toBeNull();
  });

  it('returns null when resolvedBin does not end in .cmd or .bat', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: ['x'.repeat(50_000)] })).toBeNull();
  });

  it('matches .cmd and .bat case-insensitively', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.CMD', args: [] })).toBeNull();
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.BAT', args: [] })).toBeNull();
  });

  it('returns null when the composed command line fits under the safe limit', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: ['short arg'] })).toBeNull();
  });

  it('treats a non-array args value as empty', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: undefined })).toBeNull();
  });

  it('flags a command line that exceeds the CreateProcess limit after cmd-shim quoting', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    const error = checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: ['x'.repeat(40_000)] });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('AGENT_PROMPT_TOO_LARGE');
    expect(error?.message).toContain('runs through a .cmd shim');
    expect(error?.commandLineLength).toBeGreaterThan(32_767 - 256);
  });

  it('quotes an arg containing whitespace/special chars and doubles embedded %/quote characters', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    // An arg with a space and a percent sign forces the quoting branch; a
    // huge count of them pushes the assembled line over the safe limit so
    // we can observe the quoting math took effect (roughly 4x per char).
    const bigArg = '% arg&<>|^'.repeat(4000);
    const error = checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: [bigArg] });
    expect(error).not.toBeNull();
  });
});

describe('checkWindowsDirectExeCommandLineBudget', () => {
  it('returns null when def is nullish', () => {
    expect(checkWindowsDirectExeCommandLineBudget({ def: null, resolvedBin: 'C:\\deepseek.exe', args: [] })).toBeNull();
  });

  it('returns null when the def does not declare maxPromptArgBytes', () => {
    const def = makeDef();
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: ['x'.repeat(50_000)] })).toBeNull();
  });

  it('returns null when resolvedBin is not a non-empty string', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: undefined, args: [] })).toBeNull();
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: '', args: [] })).toBeNull();
  });

  it('defers to the cmd-shim guard for .cmd/.bat resolved binaries (returns null here)', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: ['x'.repeat(50_000)] })).toBeNull();
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.BAT', args: ['x'.repeat(50_000)] })).toBeNull();
  });

  it('returns null for a non-Windows-shaped resolved binary regardless of size', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: '/usr/local/bin/deepseek', args: ['x'.repeat(50_000)] })).toBeNull();
  });

  it('recognizes a UNC path as Windows-shaped', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    const error = checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: '\\\\server\\share\\deepseek.exe', args: ['x'.repeat(40_000)] }
    );
    expect(error).not.toBeNull();
  });

  it('returns null when the composed command line fits under the safe limit', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: ['short'] })).toBeNull();
  });

  it('treats a non-array args value as empty', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: undefined })).toBeNull();
  });

  it('flags a command line exceeding the limit after libuv quote-escaping', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    const error = checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: ['x'.repeat(40_000)] });
    expect(error).not.toBeNull();
    expect(error?.message).toContain('builds a CreateProcess command line');
    expect(error?.commandLineLength).toBeGreaterThan(32_767 - 256);
  });

  it('handles an empty-string arg via the libuv empty-arg convention', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    // Exercise the empty-arg branch of the local quote function; on its own
    // this stays comfortably under budget.
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: [''] })).toBeNull();
  });

  it('handles an arg with only whitespace (no quote, no backslash) via the simple-wrap fast path', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: ['a b c'] })).toBeNull();
  });

  it('exercises the slow-path backslash-doubling logic before a trailing quote and at string end', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    // Backslashes immediately before a quote get doubled (2n+1 rule), and
    // trailing backslashes before the closing wrap quote get doubled too.
    // Repeating this pattern many times pushes the assembled line over the
    // safe limit, proving the doubling math actually multiplies length.
    const bigArg = 'C:\\path with "quotes"\\and\\trailing\\\\'.repeat(2000);
    const error = checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: [bigArg] });
    expect(error).not.toBeNull();
  });

  it('coerces a nullish argv entry to an empty string via the `value ?? \'\'` fallback', () => {
    const def = makeDef({ maxPromptArgBytes: 100 });
    // Both quote helpers open with `String(value ?? '')` — passing a
    // literal null/undefined array element (a defensive case a caller
    // could hit if `args` is loosely typed) exercises the nullish branch
    // rather than always going through the truthy string path.
    expect(checkWindowsDirectExeCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.exe', args: [null, undefined] })).toBeNull();
    expect(checkWindowsCmdShimCommandLineBudget({ def: def, resolvedBin: 'C:\\deepseek.cmd', args: [null, undefined] })).toBeNull();
  });
});

// Stryker L3 (2026-10-25): the Windows quoting helpers are private, so their per-character rules
// were never pinned (every metachar in `/[\s"&<>|^%]/` could be dropped). The guards report the
// exact command-line length, so the quoted length of one arg is the length delta it adds on top of
// an over-limit padding arg.
const PAD = 'x'.repeat(33_000);
const SAFE_LIMIT = 32_767 - 256;

function cmdShimQuotedLength(arg: string): number {
  const def = makeDef({ maxPromptArgBytes: 1 });
  const base = checkWindowsCmdShimCommandLineBudget({ def, resolvedBin: 'C:\\a.cmd', args: [PAD] })!.commandLineLength!;
  return checkWindowsCmdShimCommandLineBudget({ def, resolvedBin: 'C:\\a.cmd', args: [PAD, arg] })!.commandLineLength! - base - 1;
}

function directExeQuotedLength(arg: string): number {
  const def = makeDef({ maxPromptArgBytes: 1 });
  const base = checkWindowsDirectExeCommandLineBudget({ def, resolvedBin: 'C:\\a.exe', args: [PAD] })!.commandLineLength!;
  return checkWindowsDirectExeCommandLineBudget({ def, resolvedBin: 'C:\\a.exe', args: [PAD, arg] })!.commandLineLength! - base - 1;
}

describe('cmd-shim quoting, per character (quoted form length)', () => {
  it.each([
    ['plain', 'abc', 3],
    ['empty stays empty', '', 0],
    ['backslash alone is not special', 'a\\b', 3],
    ['space', 'a b', 5],
    ['tab', 'a\tb', 5],
    ['newline', 'a\nb', 5],
    ['ampersand', 'a&b', 5],
    ['less-than', 'a<b', 5],
    ['greater-than', 'a>b', 5],
    ['pipe', 'a|b', 5],
    ['caret', 'a^b', 5],
    ['percent becomes "^%"', 'a%b', 8],
    ['two percents', '%P%', 2 + 4 + 1 + 4],
    ['quote doubled', 'a"b', 6],
    ['two quotes doubled', '""', 6],
  ])('%s', (_label, arg, expected) => {
    expect(cmdShimQuotedLength(arg)).toBe(expected);
  });
});

describe('direct-exe (libuv) quoting, per character (quoted form length)', () => {
  it.each([
    ['plain', 'abc', 3],
    ['empty becomes ""', '', 2],
    ['shell metachars are not special', 'a&|^%<>b', 8],
    ['lone backslash, no quote/space', 'a\\b', 3],
    ['space wraps', 'a b', 5],
    ['tab wraps', 'a\tb', 5],
    ['quote escaped', 'a"b', 6],
    ['backslash before quote doubled + escaped', 'a\\"', 1 + 1 + 3 + 1 + 1],
    ['two backslashes before quote', 'a\\\\"', 1 + 1 + 5 + 1 + 1],
    ['trailing backslash doubled before wrap quote', 'a \\', 1 + 2 + 2 + 1],
    ['backslash not before quote kept', 'a \\b', 1 + 4 + 1],
  ])('%s', (_label, arg, expected) => {
    expect(directExeQuotedLength(arg)).toBe(expected);
  });
});

describe('exact limit boundaries', () => {
  it('argv budget: exactly the limit passes, one byte over fails (bytes are UTF-8)', () => {
    const def = makeDef({ maxPromptArgBytes: 10 });
    expect(checkPromptArgvBudget({ def, composed: 'x'.repeat(10) }, { platform: 'win32' })).toBeNull();
    expect(checkPromptArgvBudget({ def, composed: 'x'.repeat(11) }, { platform: 'win32' })).toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE', bytes: 11, limit: 10 });
    expect(checkPromptArgvBudget({ def, composed: 'é'.repeat(6) }, { platform: 'win32' })).toMatchObject({ bytes: 12, limit: 10 });
    expect(checkPromptArgvBudget({ def, composed: 'x'.repeat(100_000) }, { platform: 'linux' })).toBeNull();
    expect(checkPromptArgvBudget({ def, composed: 'x'.repeat(100_001) }, { platform: 'linux' })).toMatchObject({ bytes: 100_001, limit: 100_000 });
  });

  it('cmd shim: a command line of exactly the safe limit passes, +1 fails', () => {
    const def = makeDef({ maxPromptArgBytes: 1 });
    // 'cmd.exe /d /s /c '(17) + 'C:\a.cmd'(8) + ' '(1) + arg + outer quotes(2)
    const fits = 'x'.repeat(SAFE_LIMIT - 28);
    expect(checkWindowsCmdShimCommandLineBudget({ def, resolvedBin: 'C:\\a.cmd', args: [fits] })).toBeNull();
    expect(checkWindowsCmdShimCommandLineBudget({ def, resolvedBin: 'C:\\a.cmd', args: [fits + 'x'] })).toMatchObject({
      code: 'AGENT_PROMPT_TOO_LARGE', commandLineLength: SAFE_LIMIT + 1, limit: SAFE_LIMIT,
    });
  });

  it('direct exe: a command line of exactly the safe limit passes, +1 fails', () => {
    const def = makeDef({ maxPromptArgBytes: 1 });
    const fits = 'x'.repeat(SAFE_LIMIT - 9); // 'C:\a.exe'(8) + ' '(1)
    expect(checkWindowsDirectExeCommandLineBudget({ def, resolvedBin: 'C:\\a.exe', args: [fits] })).toBeNull();
    expect(checkWindowsDirectExeCommandLineBudget({ def, resolvedBin: 'C:\\a.exe', args: [fits + 'x'] })).toMatchObject({
      code: 'AGENT_PROMPT_TOO_LARGE', commandLineLength: SAFE_LIMIT + 1, limit: SAFE_LIMIT,
    });
  });

  it.each([
    ['forward-slash drive', 'c:/tools/a.exe', true],
    ['lowercase drive letter', 'd:\\a.exe', true],
    ['drive letter without separator', 'C:a.exe', false],
    ['posix path', '/usr/bin/a', false],
    ['leading junk before drive', 'xC:\\a.exe', false],
    ['single leading backslash', '\\server\\a.exe', false],
  ])('Windows-shaped path detection: %s', (_label, resolvedBin, windows) => {
    const r = checkWindowsDirectExeCommandLineBudget({ def: makeDef({ maxPromptArgBytes: 1 }), resolvedBin, args: [PAD] });
    expect(r !== null).toBe(windows);
  });
});

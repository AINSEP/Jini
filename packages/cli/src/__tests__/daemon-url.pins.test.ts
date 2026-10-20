import { describe, expect, it } from 'vitest';
import {
  daemonUrlPolicyWarning,
  resolveDaemonUrl,
  sanitizeDaemonUrlForDisplay,
  type ResolveDaemonUrlOptions,
} from '../daemon-url.js';

// Characterization pins for daemon-url.ts (SEC: decides which daemon the CLI talks to).
// Written against the pre-refactor code and kept as the behaviour contract afterwards.

type Discover = NonNullable<ResolveDaemonUrlOptions['discover']>;

function recordingDiscover(result: string | null): { discover: Discover; calls: number[] } {
  const calls: number[] = [];
  const discover: Discover = async (_required, { timeoutMs }) => {
    calls.push(timeoutMs);
    return result;
  };
  return { discover, calls };
}

const ENV = 'JINI_PIN_DAEMON_URL';

// Every step can be absent, empty, or populated. The truth table walks all
// 3^4 combinations and asserts the first populated step wins (defaultUrl wins
// even when it is the empty string, because only `undefined` skips it).
describe('resolveDaemonUrl resolution-order truth table', () => {
  const states = ['absent', 'empty', 'set'] as const;
  type State = (typeof states)[number];
  const cases: Array<[State, State, State, State]> = [];
  for (const f of states) for (const e of states) for (const d of states) for (const def of states) cases.push([f, e, d, def]);

  it.each(cases)('flag=%s env=%s discover=%s default=%s', async (f, e, d, def) => {
    const { discover, calls } = recordingDiscover(d === 'set' ? 'http://127.0.0.1:3' : d === 'empty' ? '' : null);
    const options: ResolveDaemonUrlOptions = {
      env: e === 'absent' ? {} : { [ENV]: e === 'set' ? 'http://127.0.0.1:2' : '' },
      envVarName: ENV,
      ...(f !== 'absent' ? { flagUrl: f === 'set' ? 'http://127.0.0.1:1' : '' } : {}),
      ...(d !== 'absent' ? { discover } : {}),
      ...(def !== 'absent' ? { defaultUrl: def === 'set' ? 'http://127.0.0.1:4' : '' } : {}),
    };
    let expected: string | Error;
    if (f === 'set') expected = 'http://127.0.0.1:1';
    else if (e === 'set') expected = 'http://127.0.0.1:2';
    else if (d === 'set') expected = 'http://127.0.0.1:3';
    else if (def === 'set') expected = 'http://127.0.0.1:4';
    else if (def === 'empty') expected = '';
    else expected = new Error('no daemon URL resolved');

    if (expected instanceof Error) {
      await expect(resolveDaemonUrl({}, options)).rejects.toThrow(
        'no daemon URL resolved: pass flagUrl, set envVarName on a populated env var, supply a discover() probe, or provide defaultUrl.',
      );
    } else {
      await expect(resolveDaemonUrl({}, options)).resolves.toBe(expected);
    }
    // discover() is only probed when neither flag nor env produced a URL.
    const discoverShouldRun = d !== 'absent' && f !== 'set' && e !== 'set';
    expect(calls).toEqual(discoverShouldRun ? [800] : []);
  });
});

describe('resolveDaemonUrl edge pins', () => {
  it('treats a null flagUrl as unset', async () => {
    await expect(resolveDaemonUrl({}, { flagUrl: null, defaultUrl: 'http://127.0.0.1:9' })).resolves.toBe('http://127.0.0.1:9');
  });

  it('ignores a populated env var when envVarName is not given', async () => {
    await expect(
      resolveDaemonUrl({}, { env: { [ENV]: 'http://127.0.0.1:2' }, defaultUrl: 'http://127.0.0.1:9' }),
    ).resolves.toBe('http://127.0.0.1:9');
  });

  it('looks up the empty-string env key when envVarName is the empty string', async () => {
    await expect(resolveDaemonUrl({}, { env: { '': 'http://127.0.0.1:5' }, envVarName: '' })).resolves.toBe('http://127.0.0.1:5');
  });

  it('hands discover() the resolved env and the caller timeout', async () => {
    const seen: Array<{ env: NodeJS.ProcessEnv; timeoutMs: number }> = [];
    const env = { OTHER: 'x' };
    const discover: Discover = async ({ env: e }, { timeoutMs }) => {
      seen.push({ env: e, timeoutMs });
      return 'http://127.0.0.1:3';
    };
    await resolveDaemonUrl({}, { env, discover, timeoutMs: 25 });
    expect(seen).toEqual([{ env, timeoutMs: 25 }]);
    expect(seen[0]!.env).toBe(env);
  });

  it('propagates a discover() rejection instead of falling back to defaultUrl', async () => {
    const discover: Discover = async () => {
      throw new Error('probe exploded');
    };
    await expect(resolveDaemonUrl({}, { discover, defaultUrl: 'http://127.0.0.1:9' })).rejects.toThrow('probe exploded');
  });

  it('throws a TypeError when an untyped discover() resolves undefined (type-violating input)', async () => {
    // Malformed-input fixture: a JS caller breaking the `string | null` contract.
    const discover = (async () => undefined) as unknown as Discover;
    await expect(resolveDaemonUrl({}, { discover, defaultUrl: 'http://127.0.0.1:9' })).rejects.toThrow(TypeError);
  });

  it('warns exactly once, with the sanitized URL, for whichever step won', async () => {
    const messages: string[] = [];
    const { discover } = recordingDiscover('http://user:pw@remote.example:4111');
    await resolveDaemonUrl({}, { discover, warn: ({ message }) => { messages.push(message); } });
    expect(messages).toEqual([
      'daemon URL http://remote.example:4111/ is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.',
    ]);
  });

  it('returns the URL verbatim (credentials included) while only the warning is sanitized', async () => {
    const messages: string[] = [];
    const url = await resolveDaemonUrl({}, { defaultUrl: 'http://user:pw@remote.example', warn: ({ message }) => { messages.push(message); } });
    expect(url).toBe('http://user:pw@remote.example');
    expect(messages[0]).not.toContain('pw');
  });

  it('does not warn for an empty defaultUrl (unparseable)', async () => {
    const messages: string[] = [];
    await expect(resolveDaemonUrl({}, { defaultUrl: '', warn: ({ message }) => { messages.push(message); } })).resolves.toBe('');
    expect(messages).toEqual([]);
  });
});

describe('daemonUrlPolicyWarning truth table', () => {
  it.each([
    ['https://remote.example', null],
    ['HTTPS://remote.example', null],
    ['http://localhost:1', null],
    ['http://LOCALHOST:1', null],
    ['http://[::1]:1', null],
    ['http://127.255.0.1', null],
    ['ws://127.0.0.1', null],
    ['http://localhost.evil.example', 'warn'],
    ['http://128.0.0.1', 'warn'],
    ['http://0.0.0.0', 'warn'],
    ['ws://remote.example', 'warn'],
    ['wss://remote.example', 'warn'],
    ['file:///etc/passwd', 'warn'],
    ['http://', null],
    ['', null],
  ] as const)('%s -> %s', (url, expected) => {
    const warning = daemonUrlPolicyWarning({ url });
    if (expected === null) expect(warning).toBeNull();
    else expect(warning).toMatch(/^daemon URL .* is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted\.$/);
  });

  it('is silent for an unparseable URL, so a garbage remote value is never warned about (reported, not fixed)', () => {
    expect(daemonUrlPolicyWarning({ url: 'http://remote example:4111' })).toBeNull();
  });
});

describe('sanitizeDaemonUrlForDisplay pins', () => {
  it('strips a username-only userinfo', () => {
    expect(sanitizeDaemonUrlForDisplay({ url: 'http://user@remote.example/x' })).toBe('http://remote.example/x');
  });

  it('strips a password-only userinfo', () => {
    expect(sanitizeDaemonUrlForDisplay({ url: 'http://:pw@remote.example/x' })).toBe('http://remote.example/x');
  });

  it('leaves an unparseable value without a scheme unchanged', () => {
    expect(sanitizeDaemonUrlForDisplay({ url: 'user:pw@bad host' })).toBe('user:pw@bad host');
  });

  it('leaks a malformed URL password that contains "/" because the fallback regex stops at "/" (reported, not fixed)', () => {
    expect(sanitizeDaemonUrlForDisplay({ url: 'http://u:pa/ss@bad host' })).toBe('http://u:pa/ss@bad host');
  });

  it('leaks the tail of a malformed URL password that contains "@" because only the first "@" segment is stripped (reported, not fixed)', () => {
    expect(sanitizeDaemonUrlForDisplay({ url: 'http://u:x@y@bad host' })).toBe('http://y@bad host');
  });
});

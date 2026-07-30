import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// This whole test file mocks node:os's homedir() to a fake, isolated temp
// location so `writeAntigravityModelSelection`'s default settingsPath
// parameter (derived from the real user's homedir) can be exercised safely,
// without ever touching this dev machine's real
// ~/.gemini/antigravity-cli/settings.json. Every other test in this file
// still passes an explicit settingsPath, so this mock only matters for the
// one "uses the default path" test below.
const mockState = vi.hoisted(() => ({
  fakeHome: `/tmp/agent-runtime-antigravity-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mockState.fakeHome };
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _resetAntigravityModelLockForTests,
  acquireAntigravityModelLock,
  antigravityAgentDef,
  antigravityModelLock,
  redactAntigravityAuthUrls,
  waitForAgyToReadModel,
  writeAntigravityModelSelection,
} from '../antigravity.js';

afterAll(() => {
  rmSync(mockState.fakeHome, { recursive: true, force: true });
});

describe('antigravityAgentDef shape', () => {
  it('declares the expected identity and transport fields', () => {
    expect(antigravityAgentDef.id).toBe('antigravity');
    expect(antigravityAgentDef.bin).toBe('agy');
    expect(antigravityAgentDef.supportsCustomModel).toBe(false);
    expect(antigravityAgentDef.promptViaStdin).toBe(true);
    expect(antigravityAgentDef.streamFormat).toBe('plain');
    expect(antigravityAgentDef.fallbackModels[0]?.id).toBe('default');
  });

  // The three fields that make a generic driver able to run agy at all — see
  // packages/daemon/src/agent-executor.ts's "Antigravity's two extra needs,
  // met declaratively" section. Pinned here because a driver reads them by
  // name: silently dropping one degrades to a live-streaming, unlocked,
  // log-less run that leaks a sign-in URL, with nothing failing loudly.
  it('opts into a staged log file, buffered+sanitized stdout, and the model lock', () => {
    expect(antigravityAgentDef.needsAgentLogFile).toBe(true);
    expect(antigravityAgentDef.stdoutPolicy.buffering).toBe('until-close');
    expect(antigravityAgentDef.stdoutPolicy.sanitize).toBe(redactAntigravityAuthUrls);
    expect(antigravityAgentDef.runtimeLock).toBe(antigravityModelLock);
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

describe('antigravityModelLock', () => {
  afterEach(() => {
    _resetAntigravityModelLockForTests();
  });

  /** An AbortController's signal plus an `abort()` shortcut, standing in for the driver's child-exit signal. */
  function exitSignal(): { signal: AbortSignal; exit: () => void } {
    const controller = new AbortController();
    return { signal: controller.signal, exit: () => controller.abort() };
  }

  it.each([
    ['no model was selected', undefined],
    ["the model is the 'default' sentinel", 'default'],
  ])('hands back an inert hold, without joining the chain, when %s', async (_label, model) => {
    // Mirrors buildArgs' own guard: no settings.json write happens for these,
    // so there is nothing to serialize. Proven by showing a *concurrent*
    // acquire is not blocked by this hold.
    const inert = await antigravityModelLock.acquire({ model });
    expect(inert.waitForHandoff).toBeUndefined();

    let concreteAcquired = false;
    await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' }).then((hold) => {
      concreteAcquired = true;
      hold.release();
    });
    expect(concreteAcquired).toBe(true);
    // Still callable, and still a no-op — the driver releases without knowing
    // which kind of hold it got.
    expect(inert.release()).toBeUndefined();
  });

  it('serializes two concurrent concrete-model runs: the second acquire waits for the first release', async () => {
    const first = await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' });

    let secondAcquired = false;
    const secondPromise = antigravityModelLock.acquire({ model: 'Claude Opus 4.6 (Thinking)' }).then((hold) => {
      secondAcquired = true;
      return hold;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    first.release();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);
    second.release();
  });

  it('resolves waitForHandoff as soon as the log file shows agy propagated the model', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-lock-handoff-'));
    const logPath = path.join(dir, 'agent.log');
    writeFileSync(logPath, 'Propagating selected model override to backend: label="Gemini 3.1 Pro (High)"', 'utf8');
    const hold = await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' });
    const { signal } = exitSignal();
    try {
      // `model: 'ignored-by-design'` is the point of this assertion, not a
      // typo: the label matched against the log is the one `acquire` captured,
      // so a driver cannot accidentally change which model the handoff waits
      // for by passing a different one post-spawn.
      await expect(
        hold.waitForHandoff!({ logFilePath: logPath, model: 'ignored-by-design', processExited: signal }),
      ).resolves.toBeUndefined();
    } finally {
      hold.release();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('holds until process exit when there is no log file to watch at all', async () => {
    const hold = await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' });
    const { signal, exit } = exitSignal();
    let settled = false;
    const handoff = hold.waitForHandoff!({ logFilePath: undefined, model: 'Gemini 3.1 Pro (High)', processExited: signal }).then(
      () => {
        settled = true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    // No observable propagation signal exists, so resolving early would
    // release the lock while a cold-starting agy might still read the file.
    expect(settled).toBe(false);

    exit();
    await handoff;
    expect(settled).toBe(true);
    hold.release();
  });

  it('holds until process exit when the watcher gives up without seeing the propagation line', async () => {
    // A `false` return from waitForAgyToReadModel means "stopped polling",
    // never "agy did not read the file" — so it must NOT release.
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-lock-timeout-'));
    const logPath = path.join(dir, 'agent.log');
    writeFileSync(logPath, 'some unrelated log line\n', 'utf8');
    const hold = await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' });
    const { signal, exit } = exitSignal();
    let settled = false;
    const handoff = hold
      .waitForHandoff!({ logFilePath: logPath, model: 'Gemini 3.1 Pro (High)', processExited: signal })
      .then(() => {
        settled = true;
      });

    // The poller aborts on the same signal, so exiting is what ends both.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    exit();
    await handoff;
    expect(settled).toBe(true);
    hold.release();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves waitForHandoff immediately when the process has already exited', async () => {
    // Covers the already-aborted fast path in `waitUntilAborted` — the driver
    // can register the watcher after a child that exited instantly.
    const hold = await antigravityModelLock.acquire({ model: 'Gemini 3.1 Pro (High)' });
    const { signal, exit } = exitSignal();
    exit();
    await expect(
      hold.waitForHandoff!({ logFilePath: undefined, model: 'Gemini 3.1 Pro (High)', processExited: signal }),
    ).resolves.toBeUndefined();
    hold.release();
  });
});

describe('writeAntigravityModelSelection', () => {
  function tempSettingsPath(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-write-test-'));
    return path.join(dir, 'nested', 'settings.json');
  }

  it('creates parent directories and writes {model} when no settings file exists yet', () => {
    const settingsPath = tempSettingsPath();
    writeAntigravityModelSelection('Gemini 3.1 Pro (High)', settingsPath);
    expect(existsSync(settingsPath)).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ model: 'Gemini 3.1 Pro (High)' });
  });

  it('merges the model key into existing valid JSON, preserving other keys', () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ otherSetting: 'keep-me', model: 'Old Model' }), 'utf8');

    writeAntigravityModelSelection('New Model', settingsPath);

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(written).toEqual({ otherSetting: 'keep-me', model: 'New Model' });
  });

  it('falls back to a fresh object when the existing file is corrupt JSON', () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, '{ not valid json', 'utf8');

    writeAntigravityModelSelection('Fresh Model', settingsPath);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ model: 'Fresh Model' });
  });

  it('falls back to a fresh object when the existing file parses to a JSON array', () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, '[1,2,3]', 'utf8');

    writeAntigravityModelSelection('Array Case', settingsPath);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ model: 'Array Case' });
  });

  it('falls back to a fresh object when the existing file parses to a non-object primitive', () => {
    const settingsPath = tempSettingsPath();
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, '"just a string"', 'utf8');

    writeAntigravityModelSelection('Primitive Case', settingsPath);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ model: 'Primitive Case' });
  });

  it('uses the default (mocked homedir-derived) settingsPath when none is passed', () => {
    writeAntigravityModelSelection('Default Path Model');
    const expectedPath = path.join(mockState.fakeHome, '.gemini', 'antigravity-cli', 'settings.json');
    expect(existsSync(expectedPath)).toBe(true);
    expect(JSON.parse(readFileSync(expectedPath, 'utf8'))).toEqual({ model: 'Default Path Model' });
  });
});

describe('acquireAntigravityModelLock / _resetAntigravityModelLockForTests', () => {
  it('lets a fresh acquire proceed immediately when nothing is held', async () => {
    const release = await acquireAntigravityModelLock();
    expect(typeof release).toBe('function');
    release();
  });

  it('serializes a second acquire behind the first until it is released', async () => {
    const release1 = await acquireAntigravityModelLock();

    let acquired2 = false;
    const acquire2Promise = acquireAntigravityModelLock().then((release2) => {
      acquired2 = true;
      return release2;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    const release2 = await acquire2Promise;
    expect(acquired2).toBe(true);
    release2();
  });

  it('_resetAntigravityModelLockForTests only affects the next fresh acquire, not one already in flight', async () => {
    const releaseA = await acquireAntigravityModelLock();

    let bAcquired = false;
    const acquireBPromise = acquireAntigravityModelLock().then((releaseB) => {
      bAcquired = true;
      return releaseB;
    });
    await Promise.resolve();
    expect(bAcquired).toBe(false);

    _resetAntigravityModelLockForTests();

    const releaseC = await acquireAntigravityModelLock();
    expect(bAcquired).toBe(false);
    releaseC();
    releaseA();
    const releaseB = await acquireBPromise;
    releaseB();
  });
});

describe('waitForAgyToReadModel', () => {
  it('returns false immediately without reading when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const readFile = vi.fn(async () => 'irrelevant');
    const result = await waitForAgyToReadModel('/fake/log', 'Model X', { abortSignal: controller.signal, readFile });
    expect(result).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns true as soon as the log content matches the expected propagation line', async () => {
    const readFile = vi.fn(async () => 'Propagating selected model override to backend: label="Model X"');
    const result = await waitForAgyToReadModel('/fake/log', 'Model X', { readFile, pollIntervalMs: 5, timeoutMs: 1000 });
    expect(result).toBe(true);
    expect(readFile).toHaveBeenCalledWith('/fake/log');
  });

  it('escapes regex-special characters in the expected model label before matching', async () => {
    const readFile = vi.fn(async () => 'Propagating selected model override to backend: label="C++ (v1.2)"');
    const result = await waitForAgyToReadModel('/fake/log', 'C++ (v1.2)', {
      readFile,
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    expect(result).toBe(true);
  });

  it('polls again when the log exists but does not yet match, then succeeds once it does', async () => {
    let call = 0;
    const readFile = vi.fn(async () => {
      call += 1;
      return call < 2 ? 'some unrelated log line' : 'Propagating selected model override to backend: label="Model X"';
    });
    const result = await waitForAgyToReadModel('/fake/log', 'Model X', { readFile, pollIntervalMs: 5, timeoutMs: 1000 });
    expect(result).toBe(true);
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('keeps polling without throwing when readFile rejects (e.g. log not yet created), and times out to false', async () => {
    const readFile = vi.fn(async () => {
      throw new Error('ENOENT: no such file');
    });
    const result = await waitForAgyToReadModel('/fake/log', 'Model X', { readFile, pollIntervalMs: 5, timeoutMs: 30 });
    expect(result).toBe(false);
  });

  it('breaks out of the loop immediately (skipping the sleep) once the deadline is reached right after a failed read', async () => {
    // Deterministic `now` sequence targeting the exact internal
    // `if (now() >= deadline) break;` guard (distinct from the outer
    // `while (now() < deadline)` loop condition): call 1 computes the
    // deadline, call 2 is the while-condition check that lets the loop
    // body run once, call 3 is the post-read deadline recheck that must
    // return >= deadline to hit the `break` line itself rather than
    // letting the outer while condition end the loop on the next pass.
    const nowValues = [0, 0, 10];
    let idx = 0;
    const now = () => (idx < nowValues.length ? nowValues[idx++]! : nowValues[nowValues.length - 1]!);
    const readFile = vi.fn(async () => {
      throw new Error('not there yet');
    });
    const result = await waitForAgyToReadModel('/fake/log', 'Model X', {
      readFile,
      pollIntervalMs: 1000,
      timeoutMs: 10,
      now,
    });
    expect(result).toBe(false);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('stops polling and returns false as soon as the abort signal fires mid-wait', async () => {
    const controller = new AbortController();
    const readFile = vi.fn(async () => {
      throw new Error('not yet');
    });
    const resultPromise = waitForAgyToReadModel('/fake/log', 'Model X', {
      readFile,
      pollIntervalMs: 50,
      timeoutMs: 5000,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it('uses the real fs readFile and Date.now by default when no readFile/now overrides are passed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-waitlog-test-'));
    const logPath = path.join(dir, 'agy.log');
    writeFileSync(logPath, 'Propagating selected model override to backend: label="Model X"', 'utf8');
    try {
      const result = await waitForAgyToReadModel(logPath, 'Model X', { timeoutMs: 2000, pollIntervalMs: 20 });
      expect(result).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses fully-defaulted options (timeoutMs/pollIntervalMs omitted) when the file already matches on the first read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-waitlog-defaults-test-'));
    const logPath = path.join(dir, 'agy.log');
    writeFileSync(logPath, 'Propagating selected model override to backend: label="Model X"', 'utf8');
    try {
      const result = await waitForAgyToReadModel(logPath, 'Model X');
      expect(result).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('antigravityAgentDef.buildArgs', () => {
  function tempSettingsPath(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-antigravity-buildargs-test-'));
    return path.join(dir, 'settings.json');
  }

  it('writes the model selection and returns the base print-mode argv when a concrete model is chosen', () => {
    const settingsPath = tempSettingsPath();
    const args = antigravityAgentDef.buildArgs('hi', [], [], { model: 'Gemini 3.1 Pro (High)' }, {
      antigravitySettingsPath: settingsPath,
    });
    expect(args).toEqual(['-p', '-']);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ model: 'Gemini 3.1 Pro (High)' });
  });

  it('does not write a model selection when options.model is the "default" sentinel', () => {
    const settingsPath = tempSettingsPath();
    antigravityAgentDef.buildArgs('hi', [], [], { model: 'default' }, { antigravitySettingsPath: settingsPath });
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('does not write a model selection when options.model is falsy/absent', () => {
    const settingsPath = tempSettingsPath();
    antigravityAgentDef.buildArgs('hi', [], [], {}, { antigravitySettingsPath: settingsPath });
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('prepends --log-file <path> before -p - when agentLogFilePath is set', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {}, { agentLogFilePath: '/tmp/agy.log' });
    expect(args).toEqual(['--log-file', '/tmp/agy.log', '-p', '-']);
  });

  it('omits --log-file entirely when agentLogFilePath is absent', () => {
    const args = antigravityAgentDef.buildArgs('hi', [], [], {}, {});
    expect(args).toEqual(['-p', '-']);
  });

  it('defaults extraAllowedDirs/options/runtimeContext when omitted entirely', () => {
    expect(() => antigravityAgentDef.buildArgs('hi', [])).not.toThrow();
  });
});

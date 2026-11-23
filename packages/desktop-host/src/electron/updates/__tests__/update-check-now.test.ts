import { describe, expect, it } from 'vitest';
import { createUpdateCheckNow, isNetworkUpdateError, registerUpdateCheckIpc, updateErrorMessage } from '../update-check-now.js';
import type { CheckableUpdater, UpdateCheckCopy, UpdateCheckNowDeps, UpdateNotice } from '../update-check-now.js';

type CheckResult = Awaited<ReturnType<CheckableUpdater['checkForUpdates']>>;

/** Neutral copy that echoes its inputs, so assertions see exactly what the host formatter received. */
const copy: UpdateCheckCopy = {
  notice: ({ outcome, currentVersion, isPackaged, automaticUpdates, errorMessage, errorDetails }) => outcome.kind === 'ready' ? null : ({
    type: outcome.kind === 'error' ? 'error' : 'info',
    message: `${outcome.kind}:${'version' in outcome ? outcome.version : 'reason' in outcome ? outcome.reason : ''}`,
    detail: `current=${currentVersion} packaged=${isPackaged} auto=${automaticUpdates} msg=${errorMessage ?? '-'} details=${errorDetails ?? '-'}`,
  }),
  downloadFailed: ({ version, error }) => ({ type: 'error', message: `download-failed:${version}`, detail: updateErrorMessage({ error }) }),
  checkFailedDetails: ({ error }) => `[details:${updateErrorMessage({ error })}]`,
};

function harness({ result = Promise.resolve<CheckResult>(null), ...overrides }: Partial<UpdateCheckNowDeps> & { result?: Promise<CheckResult> } = {}) {
  const notices: UpdateNotice[] = [];
  const logs: string[] = [];
  const prompts: string[] = [];
  let loads = 0;
  let checks = 0;
  const updater: CheckableUpdater = { autoDownload: true, autoInstallOnAppQuit: true, checkForUpdates: () => { checks++; return result; } };
  const deps: UpdateCheckNowDeps = {
    isPackaged: true,
    currentVersion: () => '1.0.0',
    skipReason: () => null,
    automaticUpdates: () => true,
    readyVersion: () => null,
    loadUpdater: async () => { loads++; return updater; },
    showReadyPrompt: async ({ version }) => { prompts.push(version); },
    notify: notice => { notices.push(notice); },
    log: ({ message }) => { logs.push(message); },
    copy,
    describeErrorForLog: ({ error }) => `logged(${updateErrorMessage({ error })})`,
    ...overrides,
  };
  return { check: createUpdateCheckNow(deps), updater, notices, logs, prompts, loads: () => loads, checks: () => checks };
}

const available = (version: string, downloadPromise: Promise<unknown> | null = new Promise(() => {})): CheckResult =>
  ({ isUpdateAvailable: true, updateInfo: { version }, downloadPromise });
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('createUpdateCheckNow', () => {
  it('a skipped launch reports the host reason and never loads the updater', async () => {
    const h = harness({ isPackaged: false, skipReason: () => 'dev launch' });
    expect(await h.check.checkNow()).toEqual({ kind: 'unavailable', reason: 'dev launch' });
    expect(h.notices).toEqual([{ type: 'info', message: 'unavailable:dev launch', detail: 'current=1.0.0 packaged=false auto=true msg=- details=-' }]);
    expect(h.loads()).toBe(0);
  });

  it('no newer release (or no result) is up to date with the running version and keeps controller flags', async () => {
    const h = harness({ result: Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }) });
    expect(await h.check.checkNow()).toEqual({ kind: 'up-to-date', version: '1.0.0' });
    expect(h.updater.autoDownload).toBe(true);
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
    const empty = harness();
    expect(await empty.check.checkNow()).toEqual({ kind: 'up-to-date', version: '1.0.0' });
    const versionless = harness({ result: Promise.resolve({ isUpdateAvailable: true }) });
    expect(await versionless.check.checkNow()).toEqual({ kind: 'up-to-date', version: '1.0.0' });
  });

  it('a newer release downloads through the shared updater and leaves the ready prompt to the controller', async () => {
    const h = harness({ result: Promise.resolve(available('1.1.0')) });
    expect(await h.check.checkNow()).toEqual({ kind: 'downloading', version: '1.1.0' });
    expect(h.notices.map(n => n.message)).toEqual(['downloading:1.1.0']);
    expect(h.prompts).toEqual([]);
    const noDownload = harness({ result: Promise.resolve(available('1.1.0', null)) });
    expect(await noDownload.check.checkNow()).toEqual({ kind: 'downloading', version: '1.1.0' });
  });

  it('a failed download logs through the host formatter and shows the host download notice', async () => {
    const h = harness({ result: Promise.resolve(available('1.1.0', Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')))) });
    await h.check.checkNow();
    await tick();
    expect(h.logs).toEqual(['update download failed: logged(net::ERR_INTERNET_DISCONNECTED)']);
    expect(h.notices[1]).toEqual({ type: 'error', message: 'download-failed:1.1.0', detail: 'net::ERR_INTERNET_DISCONNECTED' });
  });

  it('an update this copy already downloaded shows the existing prompt instead of checking', async () => {
    const h = harness({ readyVersion: () => '1.1.0' });
    expect(await h.check.checkNow()).toEqual({ kind: 'ready', version: '1.1.0' });
    expect(h.prompts).toEqual(['1.1.0']);
    expect(h.checks()).toBe(0);
    expect(h.notices).toEqual([]);
  });

  it('automatic updates off: looks only, downloads nothing, ignores a ready download', async () => {
    const h = harness({ automaticUpdates: () => false, readyVersion: () => '1.1.0', result: Promise.resolve(available('1.2.0')) });
    expect(await h.check.checkNow()).toEqual({ kind: 'available', version: '1.2.0' });
    expect(h.updater.autoDownload).toBe(false);
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    expect(h.prompts).toEqual([]);
    expect(h.notices[0]!.detail).toContain('auto=false');
  });

  it('a failed check logs through the host formatter and hands the raw message and details to the copy', async () => {
    const h = harness({ result: Promise.reject(new Error('HttpError: 403')) });
    expect(await h.check.checkNow()).toEqual({ kind: 'error' });
    expect(h.logs).toEqual(['update check failed: logged(HttpError: 403)']);
    expect(h.notices).toEqual([{ type: 'error', message: 'error:', detail: 'current=1.0.0 packaged=true auto=true msg=HttpError: 403 details=[details:HttpError: 403]' }]);
    const thrown = harness({ loadUpdater: async () => { throw 'offline'; } });
    await thrown.check.checkNow();
    expect(thrown.notices[0]!.detail).toContain('msg=offline details=[details:offline]');
  });

  it('clicks while a check runs join it: one check, one notice; a later click checks again', async () => {
    let finish!: (value: CheckResult) => void;
    const h = harness({ result: new Promise<CheckResult>(resolve => { finish = resolve; }) });
    const first = h.check.checkNow();
    const second = h.check.checkNow();
    expect(second).toBe(first);
    await tick();
    finish({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } });
    await first;
    expect(h.checks()).toBe(1);
    expect(h.notices).toHaveLength(1);
    await h.check.checkNow();
    expect(h.checks()).toBe(2);
  });
});

describe('update check helpers', () => {
  it('classifies unreachable-server errors', () => {
    expect(isNetworkUpdateError({ message: 'getaddrinfo ENOTFOUND example.invalid' })).toBe(true);
    expect(isNetworkUpdateError({ message: 'net::ERR_NAME_NOT_RESOLVED' })).toBe(true);
    expect(isNetworkUpdateError({ message: 'HttpError: 403' })).toBe(false);
  });

  it('registers the host channel and resolves after the check', async () => {
    const handlers = new Map<string, () => Promise<void>>();
    let checks = 0;
    registerUpdateCheckIpc({
      ipcMain: { handle: (channel, listener) => { handlers.set(channel, listener); } },
      channel: 'host:check-for-updates',
      checkNow: async () => { checks++; return { kind: 'up-to-date', version: '1' }; },
    });
    expect([...handlers.keys()]).toEqual(['host:check-for-updates']);
    expect(await handlers.get('host:check-for-updates')!()).toBeUndefined();
    expect(checks).toBe(1);
  });
});

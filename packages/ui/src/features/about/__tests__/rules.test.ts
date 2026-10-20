import { describe, expect, it } from 'vitest';

import {
  ABOUT_UPDATE_KEYS as K,
  beginSilentUpdatesWrite,
  deriveAboutUpdateControl,
  isAboutUpdateActionDisabled,
  resolveSilentUpdatesWriteFailure,
  resolveSilentUpdatesWriteSuccess,
} from '../rules.js';
import type { UpdaterModel } from '../types.js';

/**
 * Every branch of the state machine, asserted on the OUTCOME rather than on
 * having run. The cases that matter most are the ones where two states look
 * alike but must not behave alike: unpackaged vs unsupported, and the three
 * different error retries.
 */

function model(over: Partial<UpdaterModel> = {}): UpdaterModel {
  return { environment: 'desktop', enabled: true, supported: true, ...over };
}

describe('deriveAboutUpdateControl — gating, before any state is consulted', () => {
  it('reports an unpackaged build as development, NOT unsupported', () => {
    // Both disable updating, but telling a developer running from source that
    // their build is "unsupported" is actively misleading.
    const control = deriveAboutUpdateControl(model({ status: { state: 'available' } }), {
      version: '1.0.0',
      packaged: false,
    });
    expect(control.statusKey).toBe(K.development);
    expect(control.statusTone).toBe('neutral');
    expect(control.primaryAction).toBe(null);
    expect(control.showReleaseLink).toBe(true);
  });

  it('checks packaged BEFORE capability — an unpackaged web build still reads development', () => {
    const control = deriveAboutUpdateControl(model({ environment: 'web' }), { version: '1.0.0', packaged: false });
    expect(control.statusKey).toBe(K.development);
  });

  it('treats a packaged build normally', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'idle' } }), {
      version: '1.0.0',
      packaged: true,
    });
    expect(control.statusKey).toBe(K.notChecked);
  });

  it('treats absent version info and absent `packaged` as normal', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'idle' } }), null).statusKey).toBe(K.notChecked);
    expect(deriveAboutUpdateControl(model({ status: { state: 'idle' } }), { version: '1' }).statusKey).toBe(
      K.notChecked,
    );
  });

  it('reports unsupported for a non-desktop environment', () => {
    const control = deriveAboutUpdateControl(model({ environment: 'web' }), null);
    expect(control.statusKey).toBe(K.unsupported);
    expect(control.statusTone).toBe('warning');
    expect(control.primaryAction).toBe(null);
  });

  it('reports unsupported when disabled or unsupported by the build', () => {
    expect(deriveAboutUpdateControl(model({ enabled: false }), null).statusKey).toBe(K.unsupported);
    expect(deriveAboutUpdateControl(model({ supported: false }), null).statusKey).toBe(K.unsupported);
  });
});

describe('deriveAboutUpdateControl — per state', () => {
  it('checking: inert button with a label, so the row does not reflow', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'checking' } }), null);
    expect(control.primaryAction).toBe(null);
    expect(control.primaryLabelKey).toBe(K.checkingLabel);
    expect(control.statusKey).toBe(K.checking);
  });

  it('not-available: up to date, offers a recheck', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'not-available' } }), null);
    expect(control.primaryAction).toBe('check');
    expect(control.statusKey).toBe(K.upToDate);
    expect(control.statusTone).toBe('success');
  });

  it('available + canDownload: offers download and names the version', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'available' }, canDownload: true, availableVersion: '2.0.0' }),
      null,
    );
    expect(control.primaryAction).toBe('download');
    expect(control.statusKey).toBe(K.available);
    expect(control.statusVars).toEqual({ version: '2.0.0' });
  });

  it('available without a known version: uses the unknown-version key and omits statusVars', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'available' }, canDownload: true }), null);
    expect(control.statusKey).toBe(K.availableUnknown);
    expect(control.statusVars).toBeUndefined();
  });

  it('available but cannot download: no action offered', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'available' }, canDownload: false, availableVersion: '2.0.0' }),
      null,
    );
    expect(control.primaryAction).toBe(null);
    expect(control.primaryLabelKey).toBe(null);
    expect(control.statusTone).toBe('warning');
  });

  it('downloading with a percent: uses the percent key and passes it through', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'downloading' }, downloadProgress: { percent: 42 } }),
      null,
    );
    expect(control.statusKey).toBe(K.downloadingPercent);
    expect(control.statusVars).toEqual({ percent: 42 });
    expect(control.primaryAction).toBe(null);
  });

  it('downloading with percent 0 still counts as known progress', () => {
    // A falsy-but-valid number — the guard must be a typeof check, not truthiness.
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'downloading' }, downloadProgress: { percent: 0 } }),
      null,
    );
    expect(control.statusKey).toBe(K.downloadingPercent);
    expect(control.statusVars).toEqual({ percent: 0 });
  });

  it('downloading without measurable progress: no percent key, no vars', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'downloading' } }), null);
    expect(control.statusKey).toBe(K.downloading);
    expect(control.statusVars).toBeUndefined();
  });

  it('downloaded + installer handed off: offers quit and HIDES the release link', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'downloaded' }, installerOpened: true, canQuitAfterInstallerOpen: true }),
      null,
    );
    expect(control.primaryAction).toBe('quit');
    expect(control.showReleaseLink).toBe(false);
    expect(control.statusKey).toBe(K.opening);
  });

  it('downloaded + payload handoff: says restarting rather than opening', () => {
    const control = deriveAboutUpdateControl(
      model({
        status: { state: 'downloaded' },
        installerOpened: true,
        canQuitAfterInstallerOpen: true,
        updateKind: 'payload',
      }),
      null,
    );
    expect(control.statusKey).toBe(K.installingRestart);
  });

  it('downloaded + installer opened but quitting not allowed: falls through to install', () => {
    const control = deriveAboutUpdateControl(
      model({
        status: { state: 'downloaded' },
        installerOpened: true,
        canQuitAfterInstallerOpen: false,
        canOpenInstaller: true,
      }),
      null,
    );
    expect(control.primaryAction).toBe('install');
    expect(control.showReleaseLink).toBe(true);
  });

  it('downloaded: install offered via either capability', () => {
    for (const caps of [{ canOpenInstaller: true }, { canApplyInPlace: true }]) {
      const control = deriveAboutUpdateControl(model({ status: { state: 'downloaded' }, ...caps }), null);
      expect(control.primaryAction).toBe('install');
      expect(control.statusTone).toBe('success');
    }
  });

  it('downloaded + payload: label says install-and-restart', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'downloaded' }, canApplyInPlace: true, updateKind: 'payload' }),
      null,
    );
    expect(control.primaryLabelKey).toBe(K.installRestart);
  });

  it('downloaded + installer kind: label says install now', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'downloaded' }, canOpenInstaller: true, updateKind: 'installer' }),
      null,
    );
    expect(control.primaryLabelKey).toBe(K.installNow);
  });

  it('downloaded with no install capability: no action', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'downloaded' } }), null);
    expect(control.primaryAction).toBe(null);
    expect(control.primaryLabelKey).toBe(null);
  });

  it('downloaded names the version when known', () => {
    const known = deriveAboutUpdateControl(
      model({ status: { state: 'downloaded' }, canApplyInPlace: true, availableVersion: '3.1.0' }),
      null,
    );
    expect(known.statusKey).toBe(K.ready);
    expect(known.statusVars).toEqual({ version: '3.1.0' });
    const unknown = deriveAboutUpdateControl(
      model({ status: { state: 'downloaded' }, canApplyInPlace: true }),
      null,
    );
    expect(unknown.statusKey).toBe(K.readyUnknown);
    expect(unknown.statusVars).toBeUndefined();
  });

  it('installing: no action and the release link is hidden', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'installing' } }), null);
    expect(control.primaryAction).toBe(null);
    expect(control.showReleaseLink).toBe(false);
    expect(control.statusKey).toBe(K.installing);
  });

  it('unsupported state: warning, no action', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'unsupported' } }), null);
    expect(control.statusKey).toBe(K.unsupported);
    expect(control.statusTone).toBe('warning');
    expect(control.primaryAction).toBe(null);
  });

  it('idle and unknown states both offer a check', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'idle' } }), null).primaryAction).toBe('check');
    expect(deriveAboutUpdateControl(model(), null).primaryAction).toBe('check');
    // A state a newer backend reports that this build predates.
    const future = model({ status: { state: 'quantum-tunnelling' as never } });
    expect(deriveAboutUpdateControl(future, null).primaryAction).toBe('check');
  });
});

describe('deriveAboutUpdateControl — error retry picks the furthest-along step', () => {
  it('retries INSTALL when a download is on disk and installable', () => {
    // Sending the operator back to "check" would discard the expensive part.
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error', downloadPath: '/tmp/u.dmg' }, canOpenInstaller: true }),
      null,
    );
    expect(control.primaryAction).toBe('install');
    expect(control.statusTone).toBe('error');
    expect(control.primaryLabelKey).toBe(K.retry);
  });

  it('retries DOWNLOAD when a version is known but nothing is on disk', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error' }, availableVersion: '2.0.0', canDownload: true }),
      null,
    );
    expect(control.primaryAction).toBe('download');
  });

  it('falls back to CHECK when there is nothing to resume', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'error' } }), null).primaryAction).toBe('check');
  });

  it('does not retry install when a path exists but nothing can install it', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error', downloadPath: '/tmp/u.dmg' } }),
      null,
    );
    expect(control.primaryAction).toBe('check');
  });

  it('does not retry download when a version is known but downloading is not possible', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error' }, availableVersion: '2.0.0', canDownload: false }),
      null,
    );
    expect(control.primaryAction).toBe('check');
  });

  it('always keeps the release link on error, as a manual escape hatch', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'error' } }), null).showReleaseLink).toBe(true);
  });
});

describe('isAboutUpdateActionDisabled', () => {
  const actionable = deriveAboutUpdateControl(model({ status: { state: 'not-available' } }), null);
  const inert = deriveAboutUpdateControl(model({ status: { state: 'checking' } }), null);

  it('is enabled when there is an action and nothing is busy', () => {
    expect(isAboutUpdateActionDisabled(actionable, model())).toBe(false);
  });

  it('is disabled when there is no action', () => {
    expect(isAboutUpdateActionDisabled(inert, model())).toBe(true);
  });

  it('is disabled while the host reports busy', () => {
    expect(isAboutUpdateActionDisabled(actionable, model({ busy: true }))).toBe(true);
  });

  it('is disabled while the caller reports its own work in flight', () => {
    expect(isAboutUpdateActionDisabled(actionable, model(), true)).toBe(true);
  });

  it('defaults actionBusy to false', () => {
    expect(isAboutUpdateActionDisabled(actionable, model())).toBe(false);
  });
});

/**
 * These three are the value/busy transition half of the silent-updates
 * write. They carry no notion of "is this write still current" — that is
 * deliberately a caller-owned staleness guard's job (`createAsyncCommitGuard`
 * in `features/memory/async-commit-guard.ts`), so these tests only assert the transition each
 * function computes, not race ordering (the React hook layer owns that and
 * is tested there).
 */
describe('beginSilentUpdatesWrite', () => {
  it('applies the next value optimistically and marks busy', () => {
    expect(beginSilentUpdatesWrite(true)).toEqual({ allowSilentUpdates: true, busy: true });
    expect(beginSilentUpdatesWrite(false)).toEqual({ allowSilentUpdates: false, busy: true });
  });
});

describe('resolveSilentUpdatesWriteSuccess', () => {
  it('keeps the confirmed value and clears busy', () => {
    expect(resolveSilentUpdatesWriteSuccess(true)).toEqual({ allowSilentUpdates: true, busy: false });
    expect(resolveSilentUpdatesWriteSuccess(false)).toEqual({ allowSilentUpdates: false, busy: false });
  });
});

describe('resolveSilentUpdatesWriteFailure', () => {
  it('rolls back to the given previous value and clears busy', () => {
    expect(resolveSilentUpdatesWriteFailure(true)).toEqual({ allowSilentUpdates: true, busy: false });
    expect(resolveSilentUpdatesWriteFailure(false)).toEqual({ allowSilentUpdates: false, busy: false });
  });
});

describe('deriveAboutUpdateControl — complete output shape per state (boundary pins)', () => {
  it('development: the full control object', () => {
    expect(deriveAboutUpdateControl(model(), { version: '1', packaged: false })).toEqual({
      primaryAction: null,
      primaryLabelKey: null,
      showReleaseLink: true,
      statusKey: K.development,
      statusTone: 'neutral',
    });
  });

  it('capability-unsupported and state-unsupported produce the identical object', () => {
    const expected = {
      primaryAction: null,
      primaryLabelKey: null,
      showReleaseLink: true,
      statusKey: K.unsupported,
      statusTone: 'warning',
    };
    expect(deriveAboutUpdateControl(model({ enabled: false }), null)).toEqual(expected);
    expect(deriveAboutUpdateControl(model({ status: { state: 'unsupported' } }), null)).toEqual(expected);
  });

  it('checking: the full control object', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'checking' } }), null)).toEqual({
      primaryAction: null,
      primaryLabelKey: K.checkingLabel,
      showReleaseLink: true,
      statusKey: K.checking,
      statusTone: 'neutral',
    });
  });

  it('not-available: the full control object', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'not-available' } }), null)).toEqual({
      primaryAction: 'check',
      primaryLabelKey: K.recheck,
      showReleaseLink: true,
      statusKey: K.upToDate,
      statusTone: 'success',
    });
  });

  it('available with an empty-string version reads as unknown and carries no statusVars key', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'available' }, availableVersion: '', canDownload: true }),
      null,
    );
    expect(control).toEqual({
      primaryAction: 'download',
      primaryLabelKey: K.download,
      showReleaseLink: true,
      statusKey: K.availableUnknown,
      statusTone: 'warning',
    });
    expect('statusVars' in control).toBe(false);
  });

  it('downloading with no downloadProgress object at all carries no statusVars key', () => {
    const control = deriveAboutUpdateControl(model({ status: { state: 'downloading' } }), null);
    expect(control).toEqual({
      primaryAction: null,
      primaryLabelKey: K.downloadingLabel,
      showReleaseLink: true,
      statusKey: K.downloading,
      statusTone: 'neutral',
    });
    expect('statusVars' in control).toBe(false);
  });

  it('downloaded + installer handed off (installer kind): the full control object', () => {
    expect(
      deriveAboutUpdateControl(
        model({
          status: { state: 'downloaded' },
          installerOpened: true,
          canQuitAfterInstallerOpen: true,
          availableVersion: '2.0.0',
        }),
        null,
      ),
    ).toEqual({
      primaryAction: 'quit',
      primaryLabelKey: K.quit,
      showReleaseLink: false,
      statusKey: K.opening,
      statusTone: 'neutral',
    });
  });

  it('downloaded via in-place apply with a payload kind and a version: the full control object', () => {
    expect(
      deriveAboutUpdateControl(
        model({ status: { state: 'downloaded' }, canApplyInPlace: true, updateKind: 'payload', availableVersion: '3' }),
        null,
      ),
    ).toEqual({
      primaryAction: 'install',
      primaryLabelKey: K.installRestart,
      showReleaseLink: true,
      statusKey: K.ready,
      statusTone: 'success',
      statusVars: { version: '3' },
    });
  });

  it('installing: the full control object', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'installing' } }), null)).toEqual({
      primaryAction: null,
      primaryLabelKey: K.installingRestart,
      showReleaseLink: false,
      statusKey: K.installing,
      statusTone: 'neutral',
    });
  });

  it('error: the full control object', () => {
    expect(deriveAboutUpdateControl(model({ status: { state: 'error' } }), null)).toEqual({
      primaryAction: 'check',
      primaryLabelKey: K.retry,
      showReleaseLink: true,
      statusKey: K.failed,
      statusTone: 'error',
    });
  });

  it('error with an empty-string version and canDownload retries download (only null/undefined count as unknown)', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error' }, availableVersion: '', canDownload: true }),
      null,
    );
    expect(control.primaryAction).toBe('download');
  });

  it('error with no downloadPath field does not retry install, even when installable', () => {
    const control = deriveAboutUpdateControl(
      model({ status: { state: 'error' }, canOpenInstaller: true }),
      null,
    );
    expect(control.primaryAction).toBe('check');
  });

  it('no status at all: offers a check (the full control object)', () => {
    expect(deriveAboutUpdateControl(model(), null)).toEqual({
      primaryAction: 'check',
      primaryLabelKey: K.check,
      showReleaseLink: true,
      statusKey: K.notChecked,
      statusTone: 'neutral',
    });
  });

  it('a state named like an Object.prototype member still falls back to check', () => {
    // Same `as never` stand-in as the unknown-state case above: a value the
    // backend may send that the `UpdaterState` union does not admit.
    const control = deriveAboutUpdateControl(model({ status: { state: 'toString' as never } }), null);
    expect(control.statusKey).toBe(K.notChecked);
  });
});

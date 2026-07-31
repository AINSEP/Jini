import { describe, expect, it } from 'vitest';

import {
  ABOUT_UPDATE_KEYS as K,
  deriveAboutUpdateControl,
  isAboutUpdateActionDisabled,
} from '../../../tabs/about/index.js';
import type { UpdaterModel } from '../../../tabs/about/index.js';

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

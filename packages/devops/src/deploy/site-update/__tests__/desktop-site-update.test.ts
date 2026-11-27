import { describe, expect, it } from 'vitest';
import type { SiteUpdateApproval, SiteUpdateVerification } from '../contracts.js';
import { createDesktopSiteUpdate, type DesktopAppUpdaterPort, type DesktopSiteMigratePort } from '../desktop-site-update.js';
import { createFakeSiteUpdate } from '../fake-site-update.js';
import { runSiteUpdate } from '../run-site-update.js';

const approval: SiteUpdateApproval = { kind: 'owner-approval', approvedBy: 'owner-1', toVersion: '1.3.0' };

interface DesktopRig {
  calls: string[];
  state: { appVersion: string; dataVersion: string };
}

/** Recording app-updater + site-migrate + health ports over a pretend installed app and site database. */
function setup(options: { health?: SiteUpdateVerification; failMigrate?: boolean; appIgnoresSwap?: boolean; managedRollback?: boolean } = {}) {
  const rig: DesktopRig = { calls: [], state: { appVersion: '1.2.0', dataVersion: '1.2.0' } };
  let staged: string | null = null;
  const app: DesktopAppUpdaterPort = {
    currentVersion: async () => { rig.calls.push('app.currentVersion'); return rig.state.appVersion; },
    stage: async ({ version }) => { rig.calls.push(`app.stage:${version}`); staged = version; },
    applyStaged: async ({ version }) => {
      rig.calls.push(`app.applyStaged:${version}`);
      if (staged !== version) throw new Error('nothing staged');
      // An updater that reports success but leaves the old app in place (e.g. the swap was undone on relaunch).
      if (!options.appIgnoresSwap) rig.state.appVersion = version;
    },
    rollbackTo: async ({ version }) => { rig.calls.push(`app.rollbackTo:${version}`); rig.state.appVersion = version; },
  };
  const migrate: DesktopSiteMigratePort = {
    migrate: async ({ toVersion }) => {
      rig.calls.push(`site.migrate:${toVersion}`);
      if (options.failMigrate) throw new Error('migration 0042 failed');
      rig.state.dataVersion = toVersion;
    },
    restore: async ({ backupId }) => { rig.calls.push(`site.restore:${backupId}`); rig.state.dataVersion = '1.2.0'; },
  };
  const shared = createFakeSiteUpdate({ runningVersion: '1.2.0', latest: { version: '1.3.0', notes: 'New editor.' } });
  const rollbackDeployment = async ({ previousVersion, backupId }: { previousVersion: string; backupId: string }) => {
    rig.calls.push(`managed.rollback:${previousVersion}:${backupId}`);
    rig.state = { appVersion: previousVersion, dataVersion: previousVersion };
  };
  const site = createDesktopSiteUpdate({
    feed: shared.feed,
    app,
    migrate,
    health: { check: async ({ expectedVersion }) => { rig.calls.push(`health:${expectedVersion}`); return options.health ?? { status: 'healthy' }; } },
  }, options.managedRollback ? { rollbackDeployment } : {});
  return { rig, site, ports: { ...shared.ports, site } };
}

async function planned(site: ReturnType<typeof setup>['site']) {
  const update = await site.checkForUpdate({ runningVersion: '1.2.0' });
  if (!update) throw new Error('expected an update');
  return site.planUpdate({ runningVersion: '1.2.0', update });
}

describe('createDesktopSiteUpdate — never automatic', () => {
  it('checking and planning an update stage, apply and migrate nothing', async () => {
    const { rig, site } = setup();
    const plan = await planned(site);
    expect(plan).toEqual({ fromVersion: '1.2.0', toVersion: '1.3.0', notes: 'New editor.' });
    expect(rig.calls).toEqual([]);
    expect(rig.state).toEqual({ appVersion: '1.2.0', dataVersion: '1.2.0' });
  });

  it('without the owner approval runSiteUpdate touches neither the app nor the site', async () => {
    const { rig, site, ports } = setup();
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval: undefined });
    expect(result.outcome).toBe('refused');
    expect(rig.calls).toEqual([]);
    expect(rig.state).toEqual({ appVersion: '1.2.0', dataVersion: '1.2.0' });
  });
});

describe('createDesktopSiteUpdate — through runSiteUpdate', () => {
  it('an approved update stages the app, migrates the site, swaps the app in, then verifies', async () => {
    const { rig, site, ports } = setup();
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('updated');
    expect(rig.calls).toEqual(['app.stage:1.3.0', 'site.migrate:1.3.0', 'app.applyStaged:1.3.0', 'app.currentVersion', 'health:1.3.0']);
    expect(rig.state).toEqual({ appVersion: '1.3.0', dataVersion: '1.3.0' });
    expect(result.steps.find((s) => s.step === 'apply')?.detail).toBe('Installed app 1.3.0 and moved the site data to 1.3.0.');
  });

  it('a failed live check rolls the app back to the kept version and restores the site data', async () => {
    const { rig, site, ports } = setup({ health: { status: 'unhealthy', reason: 'The home page answered 500.' } });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(rig.calls.slice(-2)).toEqual(['app.rollbackTo:1.2.0', 'site.restore:backup-1']);
    expect(rig.state).toEqual({ appVersion: '1.2.0', dataVersion: '1.2.0' });
  });

  it('an app that did not land on the new version fails the check without asking the site', async () => {
    const { rig, site, ports } = setup({ appIgnoresSwap: true });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(rig.calls).not.toContain('health:1.3.0');
    expect(result.steps.find((s) => s.step === 'verify')?.detail).toBe('The app is still on 1.2.0, not 1.3.0.');
  });

  it('a failed site migration never swaps the new app in, and both sides are put back', async () => {
    const { rig, site, ports } = setup({ failMigrate: true });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(rig.calls).toEqual(['app.stage:1.3.0', 'site.migrate:1.3.0', 'app.rollbackTo:1.2.0', 'site.restore:backup-1']);
    expect(rig.state).toEqual({ appVersion: '1.2.0', dataVersion: '1.2.0' });
  });

  it('managed rollback delegates the binary and data recovery as one operation', async () => {
    const { rig, site, ports } = setup({ health: { status: 'unhealthy', reason: 'The home page answered 500.' }, managedRollback: true });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(rig.calls).toEqual([
      'app.stage:1.3.0', 'site.migrate:1.3.0', 'app.applyStaged:1.3.0', 'app.currentVersion', 'health:1.3.0', 'managed.rollback:1.2.0:backup-1',
    ]);
    expect(rig.state).toEqual({ appVersion: '1.2.0', dataVersion: '1.2.0' });
  });
});

it('forwards the check signal and injected error id to the release read', async () => {
  const signal = new AbortController().signal;
  const calls: unknown[] = [];
  const unused = async () => { throw new Error('checking must not touch the app or data'); };
  const site = createDesktopSiteUpdate({
    feed: { latestRelease: async (input, options) => { calls.push([input, options]); return { version: 'nightly', notes: '' }; } },
    app: { currentVersion: unused, stage: unused, applyStaged: unused, rollbackTo: unused },
    migrate: { migrate: unused, restore: unused },
    health: { check: unused },
  }, { ids: { newId: () => 'ERR-TEST-0000-0000-0002' } });
  await expect(site.checkForUpdate({ runningVersion: '1.2.0' }, { signal })).rejects.toThrow(/ERR-TEST-0000-0000-0002:.*nightly/);
  expect(calls).toEqual([[{}, { signal }]]);
});

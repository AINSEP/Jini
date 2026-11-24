import { describe, expect, it } from 'vitest';
import type { SiteUpdateApproval, SiteUpdatePlan } from '../contracts.js';
import { createFakeSiteUpdate, type FakeSiteUpdateOptions } from '../fake-site-update.js';
import { runSiteUpdate } from '../run-site-update.js';

const plan: SiteUpdatePlan = { fromVersion: '0.7.3-next.2', toVersion: '0.7.3', notes: 'Faster pages.' };
const approval: SiteUpdateApproval = { kind: 'owner-approval', approvedBy: 'owner-1', toVersion: '0.7.3' };

function setup(options: FakeSiteUpdateOptions = {}) {
  return createFakeSiteUpdate({ runningVersion: '0.7.3-next.2', latest: { version: '0.7.3', notes: 'Faster pages.' } }, options);
}

describe('runSiteUpdate — never auto-update', () => {
  it('refuses without an approval and calls no port at all', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval: undefined });
    expect(result.outcome).toBe('refused');
    expect(result.steps).toEqual([{ step: 'approval', status: 'refused', detail: 'The owner has not approved this update, so nothing was changed.' }]);
    expect(fake.calls).toEqual([]);
    expect(fake.state.liveVersion).toBe('0.7.3-next.2');
  });

  it('refuses an approval given for a different version', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval: { ...approval, toVersion: '0.8.0' } });
    expect(result.outcome).toBe('refused');
    expect(fake.calls).toEqual([]);
  });

  it('refuses an approval with no approver named', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval: { ...approval, approvedBy: ' ' } });
    expect(result.outcome).toBe('refused');
    expect(fake.calls).toEqual([]);
  });

  it('refuses a plan that is not an upgrade, without calling any port', async () => {
    const fake = setup();
    const downgrade = { fromVersion: '0.7.3', toVersion: '0.7.3-next.2', notes: '' };
    const result = await runSiteUpdate({ ports: fake.ports, plan: downgrade, approval: { ...approval, toVersion: '0.7.3-next.2' } });
    expect(result.outcome).toBe('refused');
    expect(result.steps[0]).toEqual({ step: 'approval', status: 'refused', detail: '0.7.3-next.2 is not newer than the running 0.7.3, so nothing was changed.' });
    expect(fake.calls).toEqual([]);
  });

  it('refuses a plan with an invalid version and reports the ERR- id', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan: { ...plan, toVersion: 'newest' }, approval: { ...approval, toVersion: 'newest' } });
    expect(result.outcome).toBe('refused');
    expect(result.errorId).toBe('ERR-FAKE-0000-0000-0001');
    expect(result.steps[0]?.detail).toBe('ERR-FAKE-0000-0000-0001: "newest" is not a version number like 1.2.3.');
    expect(fake.calls).toEqual([]);
  });
});

describe('runSiteUpdate — safety order', () => {
  it('happy path runs backup, readiness, apply, verify in that order and reports what changed', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3', 'applyUpdate:0.7.3:backup-1', 'verifyUpdate:0.7.3']);
    expect(result.outcome).toBe('updated');
    expect(result.steps.map((s) => `${s.step}:${s.status}`)).toEqual(['approval:done', 'backup:done', 'readiness:done', 'apply:done', 'verify:done']);
    expect(result.backupId).toBe('backup-1');
    expect(result.changes).toEqual({ fromVersion: '0.7.3-next.2', toVersion: '0.7.3', notes: 'Faster pages.' });
    expect(result.summary).toBe('Updated from 0.7.3-next.2 to 0.7.3. What changed: Faster pages.');
    expect(fake.state.liveVersion).toBe('0.7.3');
  });

  it('a blocked readiness gate stops before any deploy and says why', async () => {
    const fake = setup({ readiness: { status: 'blocked', reason: 'The visits table still needs its new column.' } });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3']);
    expect(result.outcome).toBe('blocked');
    expect(result.steps.at(-1)).toEqual({ step: 'readiness', status: 'blocked', detail: 'The visits table still needs its new column.' });
    expect(fake.state.liveVersion).toBe('0.7.3-next.2');
  });

  it('a failed verify rolls back to the kept previous version', async () => {
    const fake = setup({ verify: { status: 'unhealthy', reason: 'The home page answered 500.' } });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3', 'applyUpdate:0.7.3:backup-1', 'verifyUpdate:0.7.3', 'rollback:0.7.3-next.2:backup-1']);
    expect(result.outcome).toBe('rolled-back');
    expect(result.summary).toBe('The new version did not pass its live check (The home page answered 500.), so the site was rolled back to 0.7.3-next.2.');
    expect(fake.state.liveVersion).toBe('0.7.3-next.2');
  });

  it('a verify that throws is treated as unhealthy and rolls back', async () => {
    const fake = setup({ failOn: 'verifyUpdate' });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.outcome).toBe('rolled-back');
    expect(fake.calls.at(-1)).toBe('rollback:0.7.3-next.2:backup-1');
  });

  it('a failed apply rolls back, because the deploy may have half-landed', async () => {
    const fake = setup({ failOn: 'applyUpdate' });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.outcome).toBe('rolled-back');
    expect(result.errorId).toBe('ERR-FAKE-0000-0000-0001');
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3', 'applyUpdate:0.7.3:backup-1', 'rollback:0.7.3-next.2:backup-1']);
  });

  it('a failed rollback is reported loudly with the backup id to restore from', async () => {
    const fake = setup({ verify: { status: 'unhealthy', reason: 'Blank page.' }, failOn: 'rollback' });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.outcome).toBe('rollback-failed');
    expect(result.summary).toBe('ERR-FAKE-0000-0000-0001: The new version failed its live check and going back to 0.7.3-next.2 also failed. Restore backup backup-1 by hand.');
    expect(result.steps.at(-1)).toMatchObject({ step: 'rollback', status: 'failed' });
  });

  it('a failed backup stops everything before the readiness gate', async () => {
    const fake = setup({ failOn: 'createBackup' });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.outcome).toBe('failed');
    expect(result.summary).toBe('ERR-FAKE-0000-0000-0001: The backup could not be made, so nothing was changed. fake createBackup failed');
    expect(fake.calls).toEqual(['createBackup']);
  });

  it('a readiness check that throws stops before any deploy', async () => {
    const fake = setup({ failOn: 'check' });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.outcome).toBe('failed');
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3']);
  });
});

describe('runSiteUpdate — edge reporting', () => {
  it('says only the versions when the release has no notes', async () => {
    const fake = setup();
    const result = await runSiteUpdate({ ports: fake.ports, plan: { ...plan, notes: '  ' }, approval });
    expect(result.summary).toBe('Updated from 0.7.3-next.2 to 0.7.3.');
  });

  it('reports a port that rejects with a non-Error value in plain text', async () => {
    const fake = setup();
    fake.ports.backup.createBackup = async () => { throw 'disk full'; };
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(result.summary).toBe('ERR-FAKE-0000-0000-0001: The backup could not be made, so nothing was changed. disk full');
  });

  it('lets a failing error-id port surface instead of reporting a failure with no id', async () => {
    const fake = setup();
    fake.ports.ids = { newId: () => { throw new Error('id source down'); } };
    await expect(runSiteUpdate({ ports: fake.ports, plan: { ...plan, toVersion: 'bad' }, approval: { ...approval, toVersion: 'bad' } })).rejects.toThrow('id source down');
    expect(fake.calls).toEqual([]);
  });
});

describe('runSiteUpdate — abort', () => {
  it('an abort before the backup calls nothing', async () => {
    const fake = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval }, { signal: controller.signal });
    expect(result.outcome).toBe('aborted');
    expect(fake.calls).toEqual([]);
  });

  it('an abort after the readiness gate stops before apply', async () => {
    const controller = new AbortController();
    const fake = setup({ onCall: (name) => { if (name.startsWith('check:')) controller.abort(); } });
    const result = await runSiteUpdate({ ports: fake.ports, plan, approval }, { signal: controller.signal });
    expect(result.outcome).toBe('aborted');
    expect(fake.calls).toEqual(['createBackup', 'check:0.7.3']);
    expect(result.steps.at(-1)).toEqual({ step: 'apply', status: 'skipped', detail: 'Stopped before deploying because the update was cancelled. The site was not changed.' });
    expect(fake.state.liveVersion).toBe('0.7.3-next.2');
  });

  it('passes the abort signal through to every port call', async () => {
    const controller = new AbortController();
    const fake = setup();
    await runSiteUpdate({ ports: fake.ports, plan, approval }, { signal: controller.signal });
    expect(fake.signals.every((signal) => signal === controller.signal)).toBe(true);
    expect(fake.signals).toHaveLength(4);
  });
});

describe('createFakeSiteUpdate', () => {
  it('checkForUpdate and planUpdate produce a plan from the release feed', async () => {
    const fake = setup();
    const available = await fake.ports.site.checkForUpdate({ runningVersion: '0.7.3-next.2' });
    expect(available).toEqual({ latest: '0.7.3', notes: 'Faster pages.' });
    expect(await fake.ports.site.planUpdate({ runningVersion: '0.7.3-next.2', update: available! })).toEqual(plan);
    expect(await fake.feed.latestRelease({})).toEqual({ version: '0.7.3', notes: 'Faster pages.' });
  });

  it('checkForUpdate is null once the site runs the latest release', async () => {
    const fake = setup();
    await runSiteUpdate({ ports: fake.ports, plan, approval });
    expect(await fake.ports.site.checkForUpdate({ runningVersion: fake.state.liveVersion })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { SiteUpdateError, type SiteUpdateApproval, type SiteUpdateVerification } from '../contracts.js';
import { createFakeSiteUpdate } from '../fake-site-update.js';
import { runSiteUpdate } from '../run-site-update.js';
import { createSelfHostedSiteUpdate, imageTagForVersion, type ImageTagPort } from '../self-hosted-site-update.js';

const approval: SiteUpdateApproval = { kind: 'owner-approval', approvedBy: 'owner-1', toVersion: '2.1.0' };
const ids = { newId: () => 'ERR-TEST-0000-0000-0001' };

/** Recording image-tag + health ports over a pretend running container. */
function setup(options: { health?: SiteUpdateVerification; withDataRestore?: boolean; managedRollback?: boolean } = {}) {
  const calls: string[] = [];
  const state = { tag: 'v2.0.0', running: 'v2.0.0' };
  const images: ImageTagPort = {
    currentTag: async () => { calls.push('images.currentTag'); return state.running; },
    setTag: async ({ tag }) => { calls.push(`images.setTag:${tag}`); state.tag = tag; },
    redeploy: async ({ tag }) => { calls.push(`images.redeploy:${tag}`); state.running = state.tag; },
  };
  const shared = createFakeSiteUpdate({ runningVersion: '2.0.0', latest: { version: '2.1.0', notes: 'Booking form.' } });
  const site = createSelfHostedSiteUpdate(
    { feed: shared.feed, images, health: { check: async ({ expectedVersion }) => { calls.push(`health:${expectedVersion}`); return options.health ?? { status: 'healthy' }; } } },
    {
      prefix: 'v',
      ids,
      ...(options.withDataRestore ? { data: { restore: async ({ backupId }) => { calls.push(`data.restore:${backupId}`); } } } : {}),
      ...(options.managedRollback ? {
        rollbackDeployment: async ({ previousTag, backupId }: { previousTag: string; backupId: string }) => {
          calls.push(`managed.rollback:${previousTag}:${backupId}`);
          state.tag = previousTag;
          state.running = previousTag;
        },
      } : {}),
    },
  );
  return { calls, state, site, ports: { ...shared.ports, site } };
}

async function planned(site: ReturnType<typeof setup>['site']) {
  const update = await site.checkForUpdate({ runningVersion: '2.0.0' });
  if (!update) throw new Error('expected an update');
  return site.planUpdate({ runningVersion: '2.0.0', update });
}

describe('createSelfHostedSiteUpdate — never automatic', () => {
  it('checking and planning an update never reads or bumps the image tag', async () => {
    const { calls, state, site } = setup();
    expect(await planned(site)).toEqual({ fromVersion: '2.0.0', toVersion: '2.1.0', notes: 'Booking form.' });
    expect(calls).toEqual([]);
    expect(state).toEqual({ tag: 'v2.0.0', running: 'v2.0.0' });
  });

  it('without the owner approval runSiteUpdate changes no tag and restarts nothing', async () => {
    const { calls, state, site, ports } = setup();
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval: undefined });
    expect(result.outcome).toBe('refused');
    expect(calls).toEqual([]);
    expect(state.running).toBe('v2.0.0');
  });
});

describe('createSelfHostedSiteUpdate — through runSiteUpdate', () => {
  it('an approved update bumps the tag, redeploys, then checks the running tag and health', async () => {
    const { calls, state, site, ports } = setup();
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('updated');
    expect(calls).toEqual(['images.currentTag', 'images.setTag:v2.1.0', 'images.redeploy:v2.1.0', 'images.currentTag', 'health:2.1.0']);
    expect(state.running).toBe('v2.1.0');
    expect(result.steps.find((s) => s.step === 'apply')?.detail).toBe('Switched the site image from v2.0.0 to v2.1.0 and restarted it.');
  });

  it('a failed health check restores the previous tag and redeploys it', async () => {
    const { calls, state, site, ports } = setup({ health: { status: 'unhealthy', reason: 'The booking page answered 502.' } });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(calls.slice(-2)).toEqual(['images.setTag:v2.0.0', 'images.redeploy:v2.0.0']);
    expect(state).toEqual({ tag: 'v2.0.0', running: 'v2.0.0' });
  });

  it('rollback also restores the data backup when a data-restore port is given', async () => {
    const { calls, site, ports } = setup({ health: { status: 'unhealthy', reason: 'Blank page.' }, withDataRestore: true });
    await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(calls.slice(-3)).toEqual(['images.setTag:v2.0.0', 'images.redeploy:v2.0.0', 'data.restore:backup-1']);
  });

  it('managed rollback delegates the binary and data recovery as one operation', async () => {
    const { calls, state, site, ports } = setup({ health: { status: 'unhealthy', reason: 'Blank page.' }, withDataRestore: true, managedRollback: true });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(calls).toEqual([
      'images.currentTag', 'images.setTag:v2.1.0', 'images.redeploy:v2.1.0', 'images.currentTag', 'health:2.1.0', 'managed.rollback:v2.0.0:backup-1',
    ]);
    expect(state).toEqual({ tag: 'v2.0.0', running: 'v2.0.0' });
  });

  it('a container still on the old tag fails the check without asking the site', async () => {
    const { calls, state, site, ports } = setup();
    // A host that sets the tag but whose restart did not pick it up.
    ports.site = createSelfHostedSiteUpdate({
      feed: { latestRelease: async () => null },
      images: { currentTag: async () => state.running, setTag: async () => {}, redeploy: async () => {} },
      health: { check: async () => { calls.push('health'); return { status: 'healthy' }; } },
    }, { prefix: 'v' });
    const result = await runSiteUpdate({ ports, plan: await planned(site), approval });
    expect(result.outcome).toBe('rolled-back');
    expect(calls).not.toContain('health');
    expect(result.steps.find((s) => s.step === 'verify')?.detail).toBe('The site image is v2.0.0, not v2.1.0.');
  });

  it('a rollback with no recorded apply (adapter rebuilt) restores the tag derived from the kept version', async () => {
    const { calls, site } = setup();
    await site.rollback({ to: '2.0.0', backupId: 'backup-9' });
    expect(calls).toEqual(['images.setTag:v2.0.0', 'images.redeploy:v2.0.0']);
  });

  it('planning refuses a release whose version cannot be a safe image tag, before any approval', async () => {
    const { calls, site } = setup();
    await expect(site.planUpdate({ runningVersion: '2.0.0', update: { latest: 'latest', notes: '' } })).rejects.toThrow(SiteUpdateError);
    expect(calls).toEqual([]);
  });
});

describe('imageTagForVersion', () => {
  it('derives the tag from the release version, with an optional prefix', () => {
    expect(imageTagForVersion({ version: '2.1.0' })).toBe('2.1.0');
    expect(imageTagForVersion({ version: '2.1.0-rc.1' }, { prefix: 'v' })).toBe('v2.1.0-rc.1');
  });

  it('refuses a moving tag such as latest in plain words with an ERR- id', () => {
    expect(() => imageTagForVersion({ version: 'latest' }, { ids })).toThrow(
      'ERR-TEST-0000-0000-0001: "latest" is not a release version like 1.2.3, so it cannot name the site image. Moving tags such as "latest" are refused because they cannot be rolled back.',
    );
  });

  it('refuses characters an image tag cannot hold, including shell injection attempts', () => {
    expect(() => imageTagForVersion({ version: '2.1.0;rm -rf /' }, { ids })).toThrow(/^ERR-TEST-0000-0000-0001: "2.1.0;rm -rf \/" is not a release version/);
    expect(() => imageTagForVersion({ version: '2.1.0+build.5' }, { ids })).toThrow(
      'ERR-TEST-0000-0000-0001: "2.1.0+build.5" has characters an image tag cannot hold. Use only letters, digits, ".", "_" and "-".',
    );
    expect(() => imageTagForVersion({ version: '2.1.0' }, { prefix: '$(id)', ids })).toThrow(/has characters an image tag cannot hold/);
  });

  it('uses the reserved unavailable id when no id generator is given', () => {
    try {
      imageTagForVersion({ version: 'stable' });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-image-tag', errorId: 'ERR-0000-0000-0000-0000' });
    }
  });
});

it('forwards a cancellation signal while checking a release', async () => {
  const controller = new AbortController();
  const reason = new Error('owner closed the update dialog');
  controller.abort(reason);
  const unused = async () => { throw new Error('checking must not touch the running container'); };
  const site = createSelfHostedSiteUpdate({
    feed: { latestRelease: async (_input, options) => {
      options?.signal?.throwIfAborted();
      return { version: '2.1.0', notes: 'Booking form.' };
    } },
    images: { currentTag: unused, setTag: unused, redeploy: unused }, health: { check: unused },
  });
  await expect(site.checkForUpdate({ runningVersion: '2.0.0' }, { signal: controller.signal })).rejects.toBe(reason);
});

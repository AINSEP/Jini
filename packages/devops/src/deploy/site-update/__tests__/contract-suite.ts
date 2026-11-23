/**
 * @file The reusable contract suite every `SiteUpdatePort` adapter must pass: the owner's safety
 * rules for updating a live site (backup first, migration readiness gate, rollback on failure,
 * never update without an approved plan). The caller supplies its test runner, the same way
 * `serverConformance` in `@jini-ai/core` does, so this file imports none.
 */
import type { SiteUpdateApproval, SiteUpdatePlan, SiteUpdatePort } from '../contract.js';

/** The test-runner functions the suite needs (vitest, jest and node:test wrappers all fit). */
export interface SiteUpdateSuiteRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
  expect(value: unknown): { toBe(expected: unknown): void; toEqual(expected: unknown): void; toMatch(expected: RegExp): void };
}

/**
 * The world an adapter under test is set up in. A harness for a real adapter maps this onto its
 * own sandbox (a scratch deployment, a recorded vendor); the fake takes it as-is.
 */
export interface SiteUpdateScenario {
  /** The version live right now. */
  readonly runningVersion: string;
  /** Published releases, oldest first; the last one is the latest. */
  readonly releases: readonly { readonly version: string; readonly notes: string }[];
  /** Backup ids that exist and can be restored. */
  readonly backups: readonly string[];
  /** A step that fails in this world, with the plain reason it reports. */
  readonly failures?: { readonly readiness?: string; readonly deploy?: string; readonly verify?: string };
}

/** The ERR id shape every refusal and failure message starts with. */
export const ERR_MESSAGE = /^ERR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}: \S/;

const RELEASES = [
  { version: '1.0.0', notes: 'First release.' },
  { version: '1.1.0', notes: 'Adds a booking page.' },
];
const BASE: SiteUpdateScenario = { runningVersion: '1.0.0', releases: RELEASES, backups: ['backup-1'] };

const approve = (plan: SiteUpdatePlan): SiteUpdateApproval => ({ planId: plan.planId, receipt: 'card-receipt-1', approvedBy: 'human' });

async function planned(port: SiteUpdatePort): Promise<SiteUpdatePlan> {
  const result = await port.planUpdate({ runningVersion: '1.0.0', targetVersion: '1.1.0' });
  if (result.status !== 'planned') throw new Error(`expected a plan, got ${result.status}`);
  return result.plan;
}

/** Registers the contract suite for the adapter `makePort` builds (a fresh one per case). */
export function siteUpdateContractSuite(
  { describe, it, expect }: SiteUpdateSuiteRunner,
  { makePort }: { makePort: (required: { scenario: SiteUpdateScenario }) => SiteUpdatePort },
): void {
  describe('SiteUpdatePort contract', () => {
    it('reports no update (null) when the running version is the latest', async () => {
      const port = makePort({ scenario: { ...BASE, runningVersion: '1.1.0' } });
      expect(await port.checkForUpdate({ runningVersion: '1.1.0' })).toBe(null);
    });

    it('reports the latest version and its notes when one is newer', async () => {
      const port = makePort({ scenario: BASE });
      expect(await port.checkForUpdate({ runningVersion: '1.0.0' })).toEqual({ latest: '1.1.0', notes: 'Adds a booking page.' });
    });

    it('plans backup, readiness, deploy, verify in that order', async () => {
      const plan = await planned(makePort({ scenario: BASE }));
      expect(plan.steps.map(step => step.kind)).toEqual(['backup', 'readiness', 'deploy', 'verify']);
      expect([plan.fromVersion, plan.toVersion]).toEqual(['1.0.0', '1.1.0']);
    });

    it('refuses to plan toward a version that was never released', async () => {
      const result = await makePort({ scenario: BASE }).planUpdate({ runningVersion: '1.0.0', targetVersion: '9.9.9' });
      expect(result.status).toBe('refused');
      if (result.status === 'refused') expect(result.message).toMatch(ERR_MESSAGE);
    });

    it('refuses to apply without an approval, with a plain ERR- message, and changes nothing', async () => {
      const port = makePort({ scenario: BASE });
      const result = await port.applyUpdate({ plan: await planned(port), backupId: 'backup-1', approval: null });
      expect(result.status).toBe('refused');
      if (result.status !== 'refused') return;
      expect(result.reason).toBe('approval_missing');
      expect(result.message).toMatch(ERR_MESSAGE);
      expect(result.message.startsWith(result.errorId)).toBe(true);
      expect((await port.verifyUpdate({ expectedVersion: '1.0.0' })).status).toBe('passed');
    });

    it('refuses an approval given for a different plan', async () => {
      const port = makePort({ scenario: BASE });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'backup-1', approval: { ...approve(plan), planId: 'another-plan' } });
      expect(result.status === 'refused' ? result.reason : result.status).toBe('approval_mismatch');
    });

    it('refuses to apply when the named backup does not exist (backup first)', async () => {
      const port = makePort({ scenario: BASE });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'no-such-backup', approval: approve(plan) });
      expect(result.status === 'refused' ? result.reason : result.status).toBe('backup_missing');
      expect((await port.verifyUpdate({ expectedVersion: '1.0.0' })).status).toBe('passed');
    });

    it('applies an approved plan and the site then runs the new version', async () => {
      const port = makePort({ scenario: BASE });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect(result.status).toBe('updated');
      expect(result.runningVersion).toBe('1.1.0');
      expect(result.steps.map(step => step.status)).toEqual(['done', 'done', 'done', 'done']);
      expect(await port.verifyUpdate({ expectedVersion: '1.1.0' })).toEqual({ status: 'passed', runningVersion: '1.1.0' });
    });

    it('never deploys when the migration readiness check fails', async () => {
      const port = makePort({ scenario: { ...BASE, failures: { readiness: 'A data migration cannot run on the current records.' } } });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect(result.status).toBe('blocked');
      expect(result.runningVersion).toBe('1.0.0');
      expect(result.steps.map(step => `${step.kind}:${step.status}`)).toEqual(['backup:done', 'readiness:failed', 'deploy:skipped', 'verify:skipped']);
      if (result.status === 'blocked') expect(result.message).toMatch(ERR_MESSAGE);
      expect((await port.verifyUpdate({ expectedVersion: '1.0.0' })).status).toBe('passed');
    });

    it('rolls back to the previous version when verification fails and reports rolled_back', async () => {
      const port = makePort({ scenario: { ...BASE, failures: { verify: 'The home page answered with an error.' } } });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect(result.status).toBe('rolled_back');
      expect(result.runningVersion).toBe('1.0.0');
      if (result.status === 'rolled_back') {
        expect(result.failedStep).toBe('verify');
        expect(result.message).toMatch(ERR_MESSAGE);
      }
      expect((await port.verifyUpdate({ expectedVersion: '1.0.0' })).status).toBe('passed');
    });

    it('rolls back when the deploy step itself fails', async () => {
      const port = makePort({ scenario: { ...BASE, failures: { deploy: 'The new build did not start.' } } });
      const plan = await planned(port);
      const result = await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect([result.status, result.runningVersion]).toEqual(['rolled_back', '1.0.0']);
      expect(result.steps.map(step => `${step.kind}:${step.status}`)).toEqual(['backup:done', 'readiness:done', 'deploy:failed', 'verify:skipped']);
    });

    it('refuses to apply a plan made for a version that is no longer running', async () => {
      const port = makePort({ scenario: BASE });
      const plan = await planned(port);
      await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      const again = await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect(again.status === 'refused' ? again.reason : again.status).toBe('stale_plan');
    });

    it('rolls back to a version the site ran before', async () => {
      const port = makePort({ scenario: BASE });
      const plan = await planned(port);
      await port.applyUpdate({ plan, backupId: 'backup-1', approval: approve(plan) });
      expect(await port.rollback({ to: '1.0.0' })).toEqual({ status: 'rolled_back', runningVersion: '1.0.0' });
    });

    it('refuses to roll back to an unknown version, with a plain ERR- message', async () => {
      const port = makePort({ scenario: BASE });
      const result = await port.rollback({ to: '0.0.1' });
      expect(result.status).toBe('refused');
      if (result.status !== 'refused') return;
      expect(result.reason).toBe('unknown_version');
      expect(result.message).toMatch(ERR_MESSAGE);
      expect((await port.verifyUpdate({ expectedVersion: '1.0.0' })).status).toBe('passed');
    });

    it('fails verification, with an ERR- message, when a different version is running', async () => {
      const result = await makePort({ scenario: BASE }).verifyUpdate({ expectedVersion: '1.1.0' });
      expect([result.status, result.runningVersion]).toEqual(['failed', '1.0.0']);
      if (result.status === 'failed') expect(result.message).toMatch(ERR_MESSAGE);
    });
  });
}

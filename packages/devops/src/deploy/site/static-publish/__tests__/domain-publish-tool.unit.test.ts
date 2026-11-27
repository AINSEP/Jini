import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { StaticPublishToolDeps } from '../../publish-tool-deps.js';
import { createHash } from "node:crypto";
import { ToolInputError } from "@jini-ai/core";
import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError, confirm, execute, plan, type ConfirmationTokenRecord, type GatewayDeps } from "@jini-ai/core/gated-mutations";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { DeployTargetInspection, LoadedDeployTarget } from "../../deploy-targets/types.js";
import { InMemoryPublishHistoryStore } from "../publish-history.js";
import { getPublishJobSnapshot } from "../publish-run.js";
import type { StaticPublishInput } from "../adapter.js";
import { publishFixture } from "./publish.fixture.js";
import { domainPublishTool } from '../domain-publish-tool.js';

test('the reviewed domain plan is confirmed by the person before agent execution', async () => {
  const events: string[] = [];
  const deps = { workspaceId: 'ws', clock: { nowMs: () => 0 }, gatedMutations: { gatewayDeps: {} },
    gatewayPlan: async () => { events.push('plan'); return { details: {}, planId: 'plan', planHash: 'hash' }; },
    gatewayConfirm: async ({ principalId, planId, planHash }: { principalId: string; planId: string; planHash: string }) => {
      assert.equal(planId, 'plan'); assert.equal(planHash, 'hash'); events.push(`confirm:${principalId}`); return { confirmationToken: 'token' };
    },
    gatewayExecute: async ({ principalId, confirmationToken }: { principalId: string; confirmationToken: string }) => {
      assert.equal(confirmationToken, 'token'); events.push(`execute:${principalId}`); return { jobId: 'job', status: 'running' };
    },
    checkToolPublishConsent: async () => null,
    approvalToolHandler: (steps: { prepare(input: { ctx: ToolExecutionContext }): Promise<unknown>; run(input: { ctx: ToolExecutionContext; prepared: unknown; confirmer: { id: string; kind: 'user' } }): Promise<unknown> }) => async (ctx: ToolExecutionContext) => {
      const prepared = await steps.prepare({ ctx }); assert.deepEqual(events, ['plan']);
      events.push('human-click'); return steps.run({ ctx, prepared, confirmer: { id: 'human', kind: 'user' } });
    },
  } as unknown as StaticPublishToolDeps;
  const handler = domainPublishTool({ deps, surfaces: {} as never, credentialSource: {} as never, historyStore: {} as never,
    config: { target: 'host', customDomain: 'example.com' }, projectName: 'Site' });
  assert.deepEqual(events, []);
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal };
  await handler(ctx);
  assert.deepEqual(events, ['plan', 'human-click', 'confirm:human', 'execute:agent']);
});

function domainFixture() {
  const f = publishFixture();
  const config = { ...f.input.config, customDomain: 'docs.example.test' };
  const domains = { inventoryStatus: 'complete', message: 'Inventory verified', fingerprint: 'reviewed-fingerprint',
    hostnames: [{ hostname: 'docs.example.test', status: 'bound' }], changes: [{ reason: 'Connect docs.example.test' }] } as const;
  const inspection: DeployTargetInspection = { resourceName: 'studio', targetId: 'host', hostingChanges: [], domains };
  const preview = vi.fn<NonNullable<LoadedDeployTarget['module']['preview']>>().mockResolvedValue(inspection);
  f.loadDeployTargets.mockResolvedValue({ ...f.registry,
    get: id => id === 'host' ? { ...f.target, module: { ...f.target.module, preview } } : undefined });
  f.resolve.mockResolvedValue({ ok: true, token: 'studio-key', credentialId: 'studio-row', basis: { id: 'studio-row', revision: 1 } });

  const historyStore = new InMemoryPublishHistoryStore({ peerKind: 'peer', resolvePublishHistoryListLimit: () => 100 });
  const tokens = new Map<string, ConfirmationTokenRecord>();
  let nowMs = Date.parse('2026-11-25T00:00:00.000Z');
  const clock = { nowMs: () => nowMs };
  const authorize: GatewayDeps['authorize'] = async ({ principalId, permission, workspaceId }) => ({
    allowed: workspaceId === 'workspace-7' && ['operator', 'agent'].includes(principalId) && ['deployments.read', 'deployments.publish'].includes(permission), reason: 'fixture policy',
  });
  const gatewayDeps: GatewayDeps = { clock, authorize, ttlSeconds: 600, generateToken: () => 'confirmation-token', idGen: { newId: () => 'plan-1' }, tokens: {
    async save({ record }) {
      if (tokens.has(record.confirmationToken)) throw new Error('Token already exists');
      tokens.set(record.confirmationToken, record);
    },
    async findByToken({ token }) { return tokens.get(token) ?? null; },
    async tryRedeem({ token, now }) {
      const current = tokens.get(token);
      if (!current || current.status !== 'minted' || current.expiresAt <= now) return { redeemed: false, record: current ?? null };
      const record = { ...current, status: 'redeemed' as const };
      tokens.set(token, record);
      return { redeemed: true, record };
    },
    async expire({ token }) {
      const current = tokens.get(token);
      if (current?.status === 'minted') tokens.set(token, { ...current, status: 'expired' });
    },
  } };
  const cards: HumanConfirmSpec[] = [];
  const approvalToolHandler: StaticPublishToolDeps['approvalToolHandler'] = (steps, flags) => async (ctx, options = {}) => {
    assert.equal(flags.flag, 'published');
    const prepared = await steps.prepare({ ctx }, options);
    cards.push(await steps.describe({ ctx, prepared }, options));
    return steps.run({ ctx, prepared, confirmer: { id: 'operator', kind: 'user' } }, options);
  };
  const planHashOf = vi.fn(({ details }: { details: unknown }) => createHash('sha256').update(JSON.stringify(details)).digest('hex'));
  const checkToolPublishConsent = vi.fn<StaticPublishToolDeps['checkToolPublishConsent']>().mockResolvedValue(null);
  const requireToolPermission = vi.fn<StaticPublishToolDeps['requireToolPermission']>().mockResolvedValue(undefined);
  const deps = {
    workspaceId: 'workspace-7', clock, gatedMutations: { gatewayDeps }, approvalToolHandler, authorize, planHashOf, checkToolPublishConsent,
    gatewayPlan: input => plan({ ...input, deps: gatewayDeps }),
    gatewayConfirm: input => confirm({ ...input, deps: gatewayDeps }),
    gatewayExecute: input => execute({ ...input, deps: gatewayDeps }),
    resolveActorClassIdentity: async ({ principalId }) => principalId === 'agent' ? 'operator' : principalId,
    staticPublishPorts: f.deps, tracker: f.tracker, hostKit: f.kit, idGen: f.input.idGen, loadDeployTargets: f.loadDeployTargets,
    requireToolPermission, publishOutputRootDir: f.input.publishOutputRootDir, exportSiteBound: f.exportSiteBound,
  } satisfies Pick<StaticPublishToolDeps, 'workspaceId' | 'clock' | 'gatedMutations' | 'approvalToolHandler' | 'authorize' | 'planHashOf' | 'checkToolPublishConsent' |
    'gatewayPlan' | 'gatewayConfirm' | 'gatewayExecute' | 'resolveActorClassIdentity' | 'staticPublishPorts' | 'tracker' | 'hostKit' | 'idGen' |
    'loadDeployTargets' | 'requireToolPermission' | 'publishOutputRootDir' | 'exportSiteBound'>;
  function unexpected(): never { throw new Error('Unexpected surface exchange'); }
  const required = { deps: deps as unknown as StaticPublishToolDeps,
    surfaces: { surfaceExchanges: { open: unexpected, deliver: unexpected, findTypedAnswerTarget: unexpected, size: () => 0 } },
    credentialSource: f.deps.credentialSource, historyStore, config, projectName: 'Studio', credentialId: 'studio-row' };
  const ctx: ToolExecutionContext = { executionId: 'request-domain', principal: { id: 'agent' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal };
  return { ...f, required, ctx, tokens, preview, domains, inspection, cards, historyStore, planHashOf, checkToolPublishConsent, requireToolPermission,
    advance: (ms: number) => { nowMs += ms; } };
}

test('unknown domain inventory never reaches an approval card or a write', async () => {
  const f = domainFixture();
  f.preview.mockResolvedValueOnce({ ...f.inspection, domains: { ...f.domains, inventoryStatus: 'unknown', message: 'Zone inventory unavailable' } });
  await expect(domainPublishTool(f.required)(f.ctx)).rejects.toMatchObject({
    constructor: ToolInputError, message: 'DOMAIN_INVENTORY_UNKNOWN: Zone inventory unavailable',
  });
  expect(f.cards).toEqual([]);
  expect(f.tokens.size).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
});

test('a blocked site consent check prevents minting a domain approval or publishing', async () => {
  const f = domainFixture();
  f.checkToolPublishConsent.mockResolvedValueOnce({ code: 'SITE_CONSENT_REQUIRED' });
  expect(await domainPublishTool(f.required)(f.ctx)).toEqual({ published: false, cancelled: false, code: 'SITE_CONSENT_REQUIRED' });
  expect(f.cards).toHaveLength(1);
  expect(f.tokens.size).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.tracker.capture).toHaveBeenCalledExactlyOnceWith({ name: 'site_publish_blocked', userId: 'agent' },
    { properties: { target: 'host', reasonClass: 'consent', source: 'assistant' } });
});

test('queues the reviewed domain changes and binds provider authorization to the fingerprint and deadline', async () => {
  const f = domainFixture();
  const approvals: StaticPublishInput['domainApproval'][] = [];
  f.publish.mockImplementationOnce(async ({ metadata }) => {
    approvals.push(metadata?.domainApproval as StaticPublishInput['domainApproval']);
    return { targetId: 'host', url: f.url, status: 'ready' };
  });
  let finish!: () => void;
  const settled = new Promise<void>(resolve => { finish = resolve; });
  const result = await domainPublishTool({ ...f.required, onSettled: finish })(f.ctx);
  expect(result).toMatchObject({ accepted: true, published: false, jobId: 'run-8', status: 'running' });
  await settled;
  expect(f.cards).toEqual([expect.objectContaining({
    toolId: 'deployment_execute_static_publish', danger: true, confirmLabel: 'Publish and apply these changes',
    details: [
      { label: 'Project', value: 'Studio' }, { label: 'Target', value: 'host' },
      { label: 'Now on docs.example.test', value: 'bound' }, { label: 'Will change', value: 'Connect docs.example.test' },
    ],
  })]);
  expect(f.tokens.get('confirmation-token')).toMatchObject({ status: 'redeemed', confirmerPrincipalId: 'operator' });
  const binding = createHash('sha256').update('{"token":"studio-key"}').digest('hex');
  expect(f.planHashOf.mock.calls).toEqual(Array.from({ length: 2 }, () => [{ details: {
    workspaceId: 'workspace-7', actorId: 'agent', config: { target: 'host', bucket: 'studio', customDomain: 'docs.example.test' }, projectName: 'Studio',
    credentialId: 'studio-row', credentialBinding: binding,
    inspection: { resourceName: 'studio', targetId: 'host', hostingChanges: [], domainFingerprint: 'reviewed-fingerprint' },
  } }]));
  expect(getPublishJobSnapshot({ deps: f.deps, workspaceId: 'workspace-7', requestId: 'request-domain' })).toMatchObject({ status: 'completed', jobId: 'run-8' });
  expect(await f.historyStore.getLast({ workspaceId: 'workspace-7', target: 'host' })).toMatchObject({ url: f.url, credentialId: 'studio-row', triggeredBy: 'agent_tool' });
  const [approval] = approvals;
  if (!approval) throw new Error('Publish did not pass the reviewed domain approval to the provider');
  expect(approval.plan).toEqual(f.domains);
  expect(approval.credentialBinding).toBe(binding);
  const authorize = (fingerprint: string) => approval.authorize({ fingerprint, accountId: 'studio-account' });
  expect(await authorize('different-fingerprint')).toBe(false);
  f.advance(600_000);
  expect(await authorize('reviewed-fingerprint')).toBe(true);
  f.advance(1);
  expect(await authorize('reviewed-fingerprint')).toBe(false);
  expect(f.requireToolPermission.mock.calls).toEqual(Array.from({ length: 3 }, () => [{
    authorize: expect.any(Function), workspaceId: 'workspace-7', principalId: 'agent', permission: 'deployments.publish',
  }]));
});

const gatewayRefusals: [Error, string][] = [
  [new PlanStaleError({ message: 'private plan' }), 'DOMAIN_PLAN_STALE: Infrastructure or the connection changed after review. Preview and confirm the current state; no publish or domain changes were started.'],
  [new TokenExpiredError({ message: 'private token' }), 'DOMAIN_APPROVAL_EXPIRED: The domain approval expired. Preview and confirm again.'],
  [new TokenAlreadyRedeemedError({ message: 'private token' }), 'DOMAIN_APPROVAL_ALREADY_USED: This approval was already used. Inspect the last publish and preview again.'],
  [new ForbiddenError({ message: 'private grant', reasonCode: 'CHANGED' }), 'DOMAIN_APPROVAL_FORBIDDEN: Permission or the approving person changed. Ask the installation owner to restore access, then preview again.'],
];

test.each(gatewayRefusals)('translates the typed refusal %s without exposing gateway internals', async (error, message) => {
  const f = domainFixture();
  await expect(domainPublishTool({ ...f.required, deps: { ...f.required.deps, gatewayExecute: async () => { throw error; } } })(f.ctx))
    .rejects.toMatchObject({ constructor: ToolInputError, message });
  expect(f.tokens.get('confirmation-token')?.status).toBe('minted');
  expect(f.publish).not.toHaveBeenCalled();
});

test('refuses to ask for approval when the shared gateway is unavailable', () => {
  const f = domainFixture();
  const { gatedMutations: _disabled, ...deps } = f.required.deps;
  expect(() => domainPublishTool({ ...f.required, deps })).toThrow(
    'DOMAIN_APPROVAL_UNAVAILABLE: The shared mutation gateway is not configured. Contact the installation owner; no domain changes were made.',
  );
  expect(f.preview).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
});

test('changed inventory between review and gateway execution prevents enqueueing a publish', async () => {
  const f = domainFixture();
  f.preview.mockResolvedValueOnce(f.inspection)
    .mockResolvedValueOnce({ ...f.inspection, domains: { ...f.domains, fingerprint: 'changed-fingerprint' } });
  await expect(domainPublishTool(f.required)(f.ctx)).rejects.toMatchObject({
    constructor: ToolInputError, message: 'DOMAIN_PLAN_STALE: Infrastructure or the connection changed after review. Preview and confirm the current state; no publish or domain changes were started.',
  });
  expect(f.tokens.get('confirmation-token')?.status).toBe('minted');
  expect(getPublishJobSnapshot({ deps: f.deps, workspaceId: 'workspace-7' })).toBeUndefined();
  expect(f.publish).not.toHaveBeenCalled();
});

test('a second domain publish is refused while another job is running', async () => {
  const f = domainFixture();
  f.deps.publishJobs.begin({ scopeId: 'workspace-7', jobId: 'first', target: 'host', startedAtIso: '2026-11-25T00:00:00.000Z' });
  await expect(domainPublishTool(f.required)(f.ctx)).rejects.toMatchObject({
    constructor: ToolInputError, message: 'ALREADY_RUNNING: A publish is running. Wait for it to finish, then preview again.',
  });
  expect(getPublishJobSnapshot({ deps: f.deps, workspaceId: 'workspace-7' })).toMatchObject({ jobId: 'first', status: 'running' });
  expect(f.publish).not.toHaveBeenCalled();
});

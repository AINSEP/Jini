import { createToolExecutor } from '@jini-ai/daemon';
import { createToolRegistry, type Principal, type ToolExecutionContext } from '@jini-ai/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPLOY_PUBLISH_ROLE,
  DEPLOY_PUBLISH_TOOL_ID,
  createDeployPublishToolRegistration,
  createRoleGatedDeployPublishPolicy,
  denyAllDeployPublishPolicy,
} from '../tool.js';
import type { DeployPublishInput, DeployPublishResult, DeployTarget, DeploymentUrlCheck } from '../types.js';

class FakeDeployTarget implements DeployTarget {
  public lastInput: DeployPublishInput | undefined;

  constructor(readonly id: string) {}

  async publish(input: DeployPublishInput): Promise<DeployPublishResult> {
    this.lastInput = input;
    return { targetId: this.id, url: `https://${input.projectName}.example`, status: 'ready' };
  }

  async checkReachability(_url: string): Promise<DeploymentUrlCheck> {
    return { reachable: true, statusCode: 200 };
  }
}

const run = { id: 'run-1' };

describe('denyAllDeployPublishPolicy', () => {
  it('denies unconditionally, regardless of principal/input', () => {
    const withRoles: Principal = { id: 'operator-1', roles: [DEFAULT_DEPLOY_PUBLISH_ROLE] };
    const withoutRoles: Principal = { id: 'anon-1' };
    expect(
      denyAllDeployPublishPolicy.authorize({
        principal: withRoles,
        run,
        tool: { id: DEPLOY_PUBLISH_TOOL_ID },
        input: { targetId: 'vercel', files: [], projectName: 'demo' },
      }),
    ).toBe('deny');
    expect(
      denyAllDeployPublishPolicy.authorize({
        principal: withoutRoles,
        run,
        tool: { id: DEPLOY_PUBLISH_TOOL_ID },
        input: {},
      }),
    ).toBe('deny');
  });
});

describe('createRoleGatedDeployPublishPolicy', () => {
  it('denies a principal with no roles at all (undefined roles)', async () => {
    const policy = createRoleGatedDeployPublishPolicy();
    const decision = await policy.authorize({
      principal: { id: 'user-1' },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(decision).toBe('deny');
  });

  it('denies a principal with an explicitly empty roles array', async () => {
    const policy = createRoleGatedDeployPublishPolicy();
    const decision = await policy.authorize({
      principal: { id: 'user-1', roles: [] },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(decision).toBe('deny');
  });

  it('denies a principal whose roles do not include any allowed role', async () => {
    const policy = createRoleGatedDeployPublishPolicy();
    const decision = await policy.authorize({
      principal: { id: 'user-1', roles: ['some-other-role'] },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(decision).toBe('deny');
  });

  it('allows a principal carrying the default role', async () => {
    const policy = createRoleGatedDeployPublishPolicy();
    const decision = await policy.authorize({
      principal: { id: 'user-1', roles: [DEFAULT_DEPLOY_PUBLISH_ROLE] },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(decision).toBe('allow');
  });

  it('honors a caller-supplied allowedRoles list instead of the default', async () => {
    const policy = createRoleGatedDeployPublishPolicy(['custom:deployer']);
    const deniedForDefault = await policy.authorize({
      principal: { id: 'user-1', roles: [DEFAULT_DEPLOY_PUBLISH_ROLE] },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(deniedForDefault).toBe('deny');

    const allowedForCustom = await policy.authorize({
      principal: { id: 'user-1', roles: ['custom:deployer'] },
      run,
      tool: { id: DEPLOY_PUBLISH_TOOL_ID },
      input: {},
    });
    expect(allowedForCustom).toBe('allow');
  });
});

describe('createDeployPublishToolRegistration', () => {
  it('registers under DEPLOY_PUBLISH_TOOL_ID with a description and no requiresConfirmation/timeoutMs by default', () => {
    const registration = createDeployPublishToolRegistration({ targets: [] });
    expect(registration.descriptor.id).toBe(DEPLOY_PUBLISH_TOOL_ID);
    expect(registration.descriptor.description).toBeTruthy();
    expect('requiresConfirmation' in registration.descriptor).toBe(false);
    expect('timeoutMs' in registration.descriptor).toBe(false);
  });

  it('defaults to denyAllDeployPublishPolicy when no policy option is supplied', () => {
    const registration = createDeployPublishToolRegistration({ targets: [] });
    expect(registration.policy).toBe(denyAllDeployPublishPolicy);
  });

  it('uses a caller-supplied policy instead of the default when provided', () => {
    const customPolicy = { authorize: () => 'allow' as const };
    const registration = createDeployPublishToolRegistration({ targets: [], policy: customPolicy });
    expect(registration.policy).toBe(customPolicy);
  });

  it('forwards requiresConfirmation and timeoutMs onto the descriptor when supplied', () => {
    const registration = createDeployPublishToolRegistration({
      targets: [],
      requiresConfirmation: true,
      timeoutMs: 30_000,
    });
    expect(registration.descriptor.requiresConfirmation).toBe(true);
    expect(registration.descriptor.timeoutMs).toBe(30_000);
  });

  it("handler dispatches to the matching bound DeployTarget's publish via publishDeploy", async () => {
    const vercel = new FakeDeployTarget('vercel');
    const cloudflare = new FakeDeployTarget('cloudflare-pages');
    const registration = createDeployPublishToolRegistration({ targets: [vercel, cloudflare], policy: { authorize: () => 'allow' } });

    const ctx: ToolExecutionContext = {
      executionId: 'exec-1',
      principal: { id: 'user-1' },
      run,
      input: { targetId: 'cloudflare-pages', files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' },
      signal: new AbortController().signal,
    };
    const result = await registration.handler(ctx);

    expect(result).toEqual({ targetId: 'cloudflare-pages', url: 'https://demo.example', status: 'ready' });
    expect(cloudflare.lastInput).toEqual({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(vercel.lastInput).toBeUndefined();
  });
});

describe('deploy.publish wired end-to-end through the real ToolExecutor', () => {
  it('denies an unauthorized principal under the default policy: the handler never runs and the audit trail stops at denied', async () => {
    const target = new FakeDeployTarget('vercel');
    const registry = createToolRegistry();
    registry.register(createDeployPublishToolRegistration({ targets: [target] }));
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(
      { id: 'anonymous-caller' },
      run,
      DEPLOY_PUBLISH_TOOL_ID,
      { targetId: 'vercel', files: [], projectName: 'demo' },
    );

    expect(result.status).toBe('denied');
    expect(target.lastInput).toBeUndefined();
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'denied']);
  });

  it('still denies a principal with roles when no role matches an explicit allowlist policy', async () => {
    const target = new FakeDeployTarget('vercel');
    const registry = createToolRegistry();
    registry.register(
      createDeployPublishToolRegistration({ targets: [target], policy: createRoleGatedDeployPublishPolicy() }),
    );
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(
      { id: 'user-1', roles: ['unrelated-role'] },
      run,
      DEPLOY_PUBLISH_TOOL_ID,
      { targetId: 'vercel', files: [], projectName: 'demo' },
    );

    expect(result.status).toBe('denied');
    expect(target.lastInput).toBeUndefined();
  });

  it('allows and completes a call from a principal holding the required role, recording a full audit trail', async () => {
    const target = new FakeDeployTarget('vercel');
    const registry = createToolRegistry();
    registry.register(
      createDeployPublishToolRegistration({ targets: [target], policy: createRoleGatedDeployPublishPolicy() }),
    );
    const executor = createToolExecutor({ registry });

    const result = await executor.execute(
      { id: 'operator-1', roles: [DEFAULT_DEPLOY_PUBLISH_ROLE] },
      run,
      DEPLOY_PUBLISH_TOOL_ID,
      { targetId: 'vercel', files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ targetId: 'vercel', url: 'https://demo.example', status: 'ready' });
    expect(target.lastInput).toEqual({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    const audit = executor.getAuditRecord(result.executionId);
    expect(audit?.events.map((e) => e.phase)).toEqual(['requested', 'authorized', 'started', 'completed']);
  });

  it('is unreachable except through ToolExecutor.execute: a route/agent holding only the ToolRegistry gets descriptors, never the handler or policy', () => {
    const registry = createToolRegistry();
    registry.register(createDeployPublishToolRegistration({ targets: [] }));
    const descriptor = registry.list().find((d) => d.id === DEPLOY_PUBLISH_TOOL_ID);
    expect(descriptor).toBeDefined();
    expect((descriptor as unknown as { handler?: unknown }).handler).toBeUndefined();
    expect((descriptor as unknown as { policy?: unknown }).policy).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { createFrontendSessionRegistry } from '../frontend-session-registry.js';
const owner = { workspaceId: 'site', principalId: 'guest', tabId: 'tab' };

describe('visitor frontend ownership', () => {
  it('refuses token swaps across guest, workspace and tab; detach expires binding', () => {
    const registry = createFrontendSessionRegistry({});
    const handle = registry.attach({ descriptor: { sessionId: 's', capabilities: ['page.click'], owner }, deliver() {} });
    for (const forged of [{ ...owner, principalId: 'other' }, { ...owner, tabId: 'other' }, { ...owner, workspaceId: 'other' }, undefined]) {
      expect(() => registry.bindRunByToken({ runId: 'r', bindToken: handle.bindToken, ...(forged ? { owner: forged } : {}) })).toThrow();
    }
    const release = registry.bindRunByToken({ runId: 'r', bindToken: handle.bindToken, owner });
    expect(registry.sessionFor({ runId: 'r' })?.sessionId).toBe('s');
    release();
    expect(registry.sessionFor({ runId: 'r' })).toBeUndefined();
    handle.detach({});
    expect(() => registry.bindRunByToken({ runId: 'r', bindToken: handle.bindToken, owner })).toThrow();
  });
  it('authenticates responses with both owner and current token and suppresses replay', async () => {
    const registry = createFrontendSessionRegistry({});
    let id = '';
    const handle = registry.attach({ descriptor: { sessionId: 's', capabilities: ['page.click'], owner }, deliver(invocation) { id = invocation.invocationId; } });
    registry.bindRunByToken({ runId: 'r', bindToken: handle.bindToken, owner });
    const call = registry.invoke({ runId: 'r', capabilityId: 'page.click', input: {} });
    expect(registry.ownsSession({ sessionId: 's', owner, bindToken: 'forged' })).toBe(false);
    expect(registry.ownsSession({ sessionId: 's', owner: { ...owner, tabId: 'other' }, bindToken: handle.bindToken })).toBe(false);
    expect(registry.ownsSession({ sessionId: 's', owner, bindToken: handle.bindToken })).toBe(true);
    expect(registry.settle({ sessionId: 's', invocationId: id, outcome: { ok: true, output: 'done' } })).toBe(true);
    expect(await call).toBe('done');
    expect(registry.settle({ sessionId: 's', invocationId: id, outcome: { ok: true, output: 'again' } })).toBe(false);
  });
  it('cancellation invalidates pending invocations; reconnect rotates the token', async () => {
    const registry = createFrontendSessionRegistry({});
    let id = '';
    const first = registry.attach({ descriptor: { sessionId: 's', capabilities: ['page.click'], owner }, deliver(i) { id = i.invocationId; } });
    registry.bindRunByToken({ runId: 'r', bindToken: first.bindToken, owner });
    const controller = new AbortController();
    const call = registry.invoke({ runId: 'r', capabilityId: 'page.click', input: {} }, { signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toThrow('cancelled');
    expect(registry.settle({ sessionId: 's', invocationId: id, outcome: { ok: true, output: true } })).toBe(false);
    first.detach({});
    const second = registry.attach({ descriptor: { sessionId: 's', capabilities: [], owner }, deliver() {} });
    expect(second.bindToken).not.toBe(first.bindToken);
    expect(() => registry.bindRunByToken({ runId: 'r', bindToken: first.bindToken, owner })).toThrow();
    second.detach({});
  });
});
it('bounds attached public sessions and releases capacity on detach', () => {
  const registry = createFrontendSessionRegistry({}, { maxSessions: 1 });
  const first = registry.attach({ descriptor: { sessionId: 's', capabilities: [], owner }, deliver() {} });
  expect(() => registry.attach({ descriptor: { sessionId: 'other', capabilities: [], owner }, deliver() {} })).toThrow('capacity');
  first.detach({});
  expect(() => registry.attach({ descriptor: { sessionId: 'other', capabilities: [], owner }, deliver() {} })).not.toThrow();
});

it('one quota scope cannot fill the global pool; guest and IP caps release on detach', () => {
  const registry = createFrontendSessionRegistry({}, { maxSessions: 256, maxSessionsPerKey: 3 });
  let sequence = 0;
  const attach = (guest: string, ip: string) => registry.attach({
    descriptor: { sessionId: String(++sequence), capabilities: [], capacityKeys: [`guest:${guest}`, `ip:${ip}`] }, deliver() {},
  });
  const first = attach('guest', 'ip'); attach('guest', 'ip2'); attach('guest', 'ip3');
  expect(() => attach('guest', 'ip4')).toThrow('capacity');
  expect(() => attach('other', 'other-ip')).not.toThrow();
  attach('guest2', 'ip'); attach('guest3', 'ip');
  expect(() => attach('guest4', 'ip')).toThrow('capacity');
  first.detach({}); first.detach({});
  const replacement = attach('guest', 'ip');
  // A stale handle must not release the replacement's capacity a second time.
  first.detach({});
  expect(() => attach('guest', 'new-ip')).toThrow('capacity');
  replacement.detach({});
});

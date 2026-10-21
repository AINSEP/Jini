import { describe, expect, test } from 'vitest';
import type { DnsChange, DnsRecord } from '../contract.js';
import { bindDnsApproval, checkDnsApproval } from '../approval.js';
import { plan } from './fakes.js';

const A = (name: string, value: string): DnsRecord => ({ name, type: 'A', ttl: 300, values: [value] });
const body = (changes: DnsChange[]) => ({ providerId: 'cloud', zone: 'example.test', changes, preserved: [], inventory: 'complete' as const, blockers: [] });
const create: DnsChange = { op: 'create', after: A('www.example.test', '192.0.2.1'), reason: 'r' };
const binding = { workspaceId: 'ws', providerAccountId: 'acct', zone: 'Example.Test.', ttlMs: 60_000, now: 1000 };

describe('bindDnsApproval', () => {
  test('binds fingerprint, workspace, account, zone and expiry; plain creates are rememberable', () => {
    const fresh = plan(body([create]));
    expect(bindDnsApproval({ plan: fresh, ...binding })).toEqual({ fingerprint: fresh.fingerprint, workspaceId: 'ws', providerAccountId: 'acct', zone: 'example.test', expiresAt: 61_000, nonRememberable: false, humanOnly: false, approvedBy: 'agent' });
  });

  test('apex and MX changes are non-rememberable; deletes are also human-only', () => {
    const apex = bindDnsApproval({ plan: plan(body([{ op: 'create', after: A('example.test', '192.0.2.1'), reason: 'r' }])), ...binding });
    expect(apex).toMatchObject({ nonRememberable: true, humanOnly: false });
    const mx: DnsRecord = { name: 'mail.example.test', type: 'MX', ttl: 300, values: [{ priority: 10, exchange: 'mx.test' }] };
    expect(bindDnsApproval({ plan: plan(body([{ op: 'update', before: mx, after: mx, reason: 'r' }])), ...binding }).nonRememberable).toBe(true);
    const deletion = bindDnsApproval({ plan: plan(body([{ op: 'delete', before: A('www.example.test', '192.0.2.9'), reason: 'r' }])), ...binding }, { approvedBy: 'human' });
    expect(deletion).toMatchObject({ nonRememberable: true, humanOnly: true, approvedBy: 'human' });
  });

  test('a malformed change with no record is not mistaken for the apex', () => {
    expect(bindDnsApproval({ plan: plan(body([{ op: 'create', reason: 'r' }])), ...binding }).nonRememberable).toBe(false);
  });
});

describe('checkDnsApproval', () => {
  const fresh = plan(body([create]));
  const approval = bindDnsApproval({ plan: fresh, ...binding });
  const check = (overrides: Record<string, unknown> = {}, optional = {}) => checkDnsApproval({ approval, freshPlan: fresh, workspaceId: 'ws', providerAccountId: 'acct', zone: 'example.test', now: 2000, ...overrides }, optional);

  test('accepts a matching, unexpired approval of an unchanged plan', () => {
    expect(check()).toEqual({ ok: true });
  });

  test.each([
    [{ workspaceId: 'other' }],
    [{ providerAccountId: 'other' }],
    [{ zone: 'other.test' }],
    [{ freshPlan: plan({ ...body([create]), zone: 'other.test' }) }],
  ])('refuses a different binding %o', overrides => {
    expect(check(overrides)).toMatchObject({ ok: false, reason: 'wrong_binding' });
  });

  test('refuses an expired approval', () => {
    expect(check({ now: 61_000 })).toMatchObject({ ok: false, reason: 'expired' });
  });

  test('refuses a partial inventory or a blocked plan', () => {
    expect(check({ freshPlan: plan({ ...body([]), inventory: 'partial' }) })).toMatchObject({ ok: false, reason: 'inventory_incomplete' });
    expect(check({ freshPlan: plan({ ...body([create]), blockers: [{ code: 'apex_cname', name: 'example.test', message: 'm' }] }) })).toMatchObject({ ok: false, reason: 'blocked' });
  });

  test('refuses a changed plan, and a forged fingerprint field is recomputed', () => {
    const changed = plan(body([{ ...create, after: A('www.example.test', '192.0.2.7') }]));
    expect(check({ freshPlan: changed })).toMatchObject({ ok: false, reason: 'stale_fingerprint' });
    expect(check({ freshPlan: { ...changed, fingerprint: approval.fingerprint } })).toMatchObject({ ok: false, reason: 'stale_fingerprint' });
  });

  test('deletes need a human approval; non-rememberable approvals cannot be reused', () => {
    const deletes = plan(body([{ op: 'delete', before: A('www.example.test', '192.0.2.9'), reason: 'r' }]));
    const agent = bindDnsApproval({ plan: deletes, ...binding });
    expect(check({ approval: agent, freshPlan: deletes })).toMatchObject({ ok: false, reason: 'human_required' });
    const human = bindDnsApproval({ plan: deletes, ...binding }, { approvedBy: 'human' });
    expect(check({ approval: human, freshPlan: deletes })).toEqual({ ok: true });
    expect(check({ approval: human, freshPlan: deletes }, { remembered: true })).toMatchObject({ ok: false, reason: 'not_rememberable' });
    expect(check({}, { remembered: true })).toEqual({ ok: true });
  });
});

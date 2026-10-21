/**
 * @file Approval BINDING for DNS change plans (the apply engine is D4). Lifted from a host deploy
 * plugin's fingerprinted, re-previewed approval and made generic: an approval is bound to
 * the exact plan (fingerprint), the workspace, the provider account and the authoritative zone,
 * and it expires. Before anything is applied the plan is recomputed and checked again here.
 *
 * Deletes are for humans only; anything touching the apex or MX is never "remembered" as a
 * standing approval, because a wrong apex or mail record takes the whole domain down.
 */
import type { DnsChange, DnsChangePlan } from './contract.js';
import { fingerprintPlan } from './plan.js';
import { normalizeDnsName } from './records.js';

export type DnsApprover = 'human' | 'agent';

export interface DnsApproval {
  readonly fingerprint: string;
  readonly workspaceId: string;
  readonly providerAccountId: string;
  readonly zone: string;
  readonly expiresAt: number;
  /** True when any change touches the apex or MX, or deletes: approve each time, never remember. */
  readonly nonRememberable: boolean;
  /** True when any change deletes: only a human approval counts. */
  readonly humanOnly: boolean;
  readonly approvedBy: DnsApprover;
}

export type DnsApprovalRefusal =
  | 'wrong_binding'
  | 'expired'
  | 'inventory_incomplete'
  | 'blocked'
  | 'stale_fingerprint'
  | 'human_required'
  | 'not_rememberable';

export type DnsApprovalCheck = { readonly ok: true } | { readonly ok: false; readonly reason: DnsApprovalRefusal; readonly message: string };

function changeName(change: DnsChange): string {
  return (change.after ?? change.before)?.name ?? '';
}

function touchesApexOrMail(change: DnsChange, zone: string): boolean {
  const types = [change.before?.type, change.after?.type];
  return types.includes('MX') || normalizeDnsName({ name: changeName(change) }) === zone;
}

/**
 * Bind an approval to one plan. `approvedBy` defaults to `agent` so an approval of unknown origin
 * fails closed on human-only plans.
 */
export function bindDnsApproval(
  required: {
    readonly plan: DnsChangePlan;
    readonly workspaceId: string;
    readonly providerAccountId: string;
    readonly zone: string;
    readonly ttlMs: number;
    readonly now: number;
  },
  optional: { readonly approvedBy?: DnsApprover } = {},
): DnsApproval {
  const zone = normalizeDnsName({ name: required.zone });
  const humanOnly = required.plan.changes.some(change => change.op === 'delete');
  return {
    fingerprint: required.plan.fingerprint,
    workspaceId: required.workspaceId,
    providerAccountId: required.providerAccountId,
    zone,
    expiresAt: required.now + required.ttlMs,
    nonRememberable: humanOnly || required.plan.changes.some(change => touchesApexOrMail(change, zone)),
    humanOnly,
    approvedBy: optional.approvedBy ?? 'agent',
  };
}

type CheckInput = Parameters<typeof checkDnsApproval>[0] & { readonly remembered: boolean };

/** Ordered checks; the first failing one is the refusal. */
const CHECKS: ReadonlyArray<readonly [DnsApprovalRefusal, (input: CheckInput) => boolean, string]> = [
  ['wrong_binding', input => input.approval.workspaceId !== input.workspaceId || input.approval.providerAccountId !== input.providerAccountId || input.approval.zone !== normalizeDnsName({ name: input.zone }) || input.freshPlan.zone !== input.approval.zone, 'The approval was given for a different workspace, provider account or zone.'],
  ['expired', input => input.now >= input.approval.expiresAt, 'The approval has expired; review the plan again.'],
  ['inventory_incomplete', input => input.freshPlan.inventory !== 'complete', 'The existing records could not be fully read, so nothing may be changed.'],
  ['blocked', input => input.freshPlan.blockers.length > 0, 'The current plan has blockers.'],
  ['stale_fingerprint', input => fingerprintPlan({ plan: input.freshPlan }) !== input.approval.fingerprint, 'The DNS records changed since the plan was approved; review the new plan.'],
  ['human_required', input => input.approval.humanOnly && input.approval.approvedBy !== 'human', 'The plan deletes records, which only a person may approve.'],
  ['not_rememberable', input => input.remembered && input.approval.nonRememberable, 'Changes to the apex, mail or deletions need a fresh approval every time.'],
];

/**
 * Re-check an approval against a plan recomputed just now. The fingerprint is recomputed from the
 * fresh plan's content rather than trusted from its field.
 * @param optional.remembered - The approval is a standing ("remember this") approval being reused.
 */
export function checkDnsApproval(
  required: {
    readonly approval: DnsApproval;
    readonly freshPlan: DnsChangePlan;
    readonly workspaceId: string;
    readonly providerAccountId: string;
    readonly zone: string;
    readonly now: number;
  },
  optional: { readonly remembered?: boolean } = {},
): DnsApprovalCheck {
  const input: CheckInput = { ...required, remembered: optional.remembered ?? false };
  const failed = CHECKS.find(([, fails]) => fails(input));
  return failed ? { ok: false, reason: failed[0], message: failed[2] } : { ok: true };
}

import type { ApprovalAnswer, ToolExecutionContext, ToolRegistration } from "@jini-ai/core";

import type { PaymentsPort } from "../../contract/payments-port.js";
import type { PaymentScope } from "../../contract/scope.js";
import type { MoneyGrantBinding } from "../../ops/grants.js";
import { LIPAY, NOW, world, type WorldOptions } from "../../ops/__tests__/harness.js";
import type { PaymentApprovalDescription } from "../deps.js";
import { buildPaymentsToolRegistrations, type PaymentsToolsOptional } from "../index.js";

/**
 * @file The payments tools wired over the REAL payments service (L4's `world()`: memory ledger,
 * kernel provider registry with the LiPay fake + a scripted provider, memory grant store). Only the
 * host-side ports are scripted here: run scope, permission evaluator, the human, the key source.
 */

export interface MintRecord {
  readonly binding: MoneyGrantBinding;
  readonly expiresAt: number;
  readonly token: string;
}

export interface ToolWorldOptions {
  readonly world?: WorldOptions;
  readonly tools?: PaymentsToolsOptional;
  /** Replace the payments port the tools see (to tamper with what they send). */
  readonly wrapPayments?: (service: PaymentsPort) => PaymentsPort;
}

export async function toolWorld(optional: ToolWorldOptions = {}) {
  const w = await world(optional.world);
  let clock = NOW;
  let keys = 0;
  const mints: MintRecord[] = [];
  const asked: PaymentApprovalDescription[] = [];
  const authorized: { principalId: string; permission: string; workspaceId: string; entityType?: string; entityId?: string }[] = [];
  const host = {
    scope: LIPAY as PaymentScope | null,
    answer: async (): Promise<ApprovalAnswer> => ({ confirmed: true }),
    /** Deny every check once this many have been allowed (Infinity = never deny). */
    allowChecks: Number.POSITIVE_INFINITY,
    onAuthorize: () => undefined as void,
    afterMint: () => undefined as void,
  };
  const tick = (ms: number) => { clock += ms; w.tick(ms); };
  const payments = optional.wrapPayments ? optional.wrapPayments(w.service) : w.service;
  const registrations: ToolRegistration[] = buildPaymentsToolRegistrations({
    payments,
    grants: {
      mint: async (required) => {
        const token = await w.grants.mint(required);
        mints.push({ ...required, token });
        host.afterMint();
        return token;
      },
    },
    scopeFor: () => host.scope,
    authorize: async (request) => {
      authorized.push(request);
      host.onAuthorize();
      const allowed = authorized.length <= host.allowChecks;
      return { allowed, reason: allowed ? "granted" : "no_grant" };
    },
    askHuman: async ({ description }) => {
      asked.push(description);
      return host.answer();
    },
    now: () => clock,
    newIdempotencyKey: () => `tool-key-${++keys}`,
  }, optional.tools);
  const handlerOf = (toolId: string) => {
    const found = registrations.find((r) => r.descriptor.id === toolId);
    if (!found) throw new Error(`no tool ${toolId}`);
    return found.handler;
  };
  const call = (toolId: string, input: unknown, controller = new AbortController()) => {
    const ctx: ToolExecutionContext = { executionId: "exec", principal: { id: "admin-1" }, run: { id: "run-1" }, input, signal: controller.signal };
    return handlerOf(toolId)(ctx) as Promise<Record<string, unknown>>;
  };
  return { w, host, mints, asked, authorized, registrations, call, tick, now: () => clock };
}

export type ToolWorld = Awaited<ReturnType<typeof toolWorld>>;

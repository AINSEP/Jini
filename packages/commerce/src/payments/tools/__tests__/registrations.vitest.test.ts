import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRANT_TTL_MS, DEFAULT_PAYMENTS_TOOL_PERMISSIONS, PAYMENTS_TOOL_IDS, PAYMENTS_TOOLS_DOMAIN, buildPaymentsToolRegistrations,
  contributePaymentsTools, paymentsToolCatalog, paymentsToolsDerivedRisk,
} from "../index.js";
import { authorizedScripted, paidLipay, SCRIPTED, USD } from "../../ops/__tests__/harness.js";
import { toolWorld } from "./harness.js";

const MONEY = [PAYMENTS_TOOL_IDS.refund, PAYMENTS_TOOL_IDS.capture, PAYMENTS_TOOL_IDS.void];
const READ = [PAYMENTS_TOOL_IDS.get, PAYMENTS_TOOL_IDS.listProviders];

describe("payments tools catalog", () => {
  it("publishes five strict schemas with the default permissions", () => {
    const catalog = paymentsToolCatalog();
    expect(catalog.map((t) => t.name)).toEqual([...READ, ...MONEY]);
    for (const tool of catalog) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.authorization.permission).toBe(READ.includes(tool.name as never) ? DEFAULT_PAYMENTS_TOOL_PERMISSIONS.read : DEFAULT_PAYMENTS_TOOL_PERMISSIONS.manage);
    }
    const refund = catalog.find((t) => t.name === PAYMENTS_TOOL_IDS.refund)!;
    expect(refund.inputSchema).toMatchObject({
      required: ["paymentId", "amount"],
      properties: { amount: { additionalProperties: false, required: ["minorUnits", "currency"], properties: { minorUnits: { type: "integer", minimum: 1 } } } },
    });
    expect(Object.keys((refund.inputSchema as { properties: object }).properties)).toEqual(["paymentId", "amount", "reason", "idempotencyKey"]);
    const capture = catalog.find((t) => t.name === PAYMENTS_TOOL_IDS.capture)!;
    expect(Object.keys((capture.inputSchema as { properties: object }).properties)).toEqual(["paymentId", "amount", "idempotencyKey"]);
    const voidTool = catalog.find((t) => t.name === PAYMENTS_TOOL_IDS.void)!;
    expect(voidTool.inputSchema).toMatchObject({ required: ["paymentId"] });
    expect(Object.keys((voidTool.inputSchema as { properties: object }).properties)).toEqual(["paymentId", "idempotencyKey"]);
  });

  it("derives read tools as side-effect free and money tools as human-confirmed mutations", () => {
    const catalog = paymentsToolCatalog();
    for (const id of READ) {
      expect(paymentsToolsDerivedRisk.get(id)).toBe("none");
      expect(catalog.find((t) => t.name === id)!.actorClassRule).toBeUndefined();
    }
    for (const id of MONEY) {
      expect(paymentsToolsDerivedRisk.get(id)).toBe("mutates-durable-state");
      expect(catalog.find((t) => t.name === id)).toMatchObject({ sideEffects: "mutates-durable-state", actorClassRule: "confirmer-must-equal-own-delegatedBy" });
    }
    expect(paymentsToolsDerivedRisk.size).toBe(5);
  });

  it("renders host permission names", () => {
    const catalog = paymentsToolCatalog({}, { permissions: { read: "shop.read", manage: "shop.money" } });
    expect(catalog.map((t) => t.authorization.permission)).toEqual(["shop.read", "shop.read", "shop.money", "shop.money", "shop.money"]);
  });
});

describe("buildPaymentsToolRegistrations", () => {
  it("registers every tool behind core's gates, read-only flags following the derived risk", async () => {
    const t = await toolWorld();
    expect(t.registrations.map((r) => r.descriptor.id)).toEqual([...READ, ...MONEY]);
    for (const r of t.registrations) {
      const readOnly = READ.includes(r.descriptor.id as never);
      expect(r.descriptor.readOnly).toBe(readOnly);
      expect(r.descriptor.sideEffects).toBe(readOnly ? "none" : "mutates-durable-state");
      expect((r.descriptor as { requiresConfirmation?: boolean }).requiresConfirmation).toBeUndefined();
    }
  });

  it("checks host-named permissions", async () => {
    const t = await toolWorld({ tools: { permissions: { manage: "shop.money" } } });
    const payment = await paidLipay(t.w);
    await t.call(PAYMENTS_TOOL_IDS.get, { paymentId: payment.id });
    await t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: payment.id, amount: USD(100) });
    expect(t.authorized.map((a) => a.permission)).toEqual([DEFAULT_PAYMENTS_TOOL_PERMISSIONS.read, "shop.money", "shop.money"]);
  });

  it("mints grants that expire after the configured ttl (default two minutes)", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    await t.call(PAYMENTS_TOOL_IDS.refund, { paymentId: payment.id, amount: USD(100) });
    expect(t.mints[0]!.expiresAt).toBe(t.now() + DEFAULT_GRANT_TTL_MS);

    const custom = await toolWorld({ tools: { grantTtlMs: 5_000 } });
    const authorized = await authorizedScripted(custom.w);
    custom.host.scope = SCRIPTED;
    await custom.call(PAYMENTS_TOOL_IDS.void, { paymentId: authorized.id });
    expect(custom.mints[0]!.expiresAt).toBe(custom.now() + 5_000);
  });

  it("refuses a ttl that is not a positive whole number of milliseconds", async () => {
    for (const grantTtlMs of [0, -1, 1.5, Number.NaN]) {
      await expect(toolWorld({ tools: { grantTtlMs } })).rejects.toThrow(RangeError);
    }
  });

  it("refuses to wire a blank permission", async () => {
    await expect(toolWorld({ tools: { permissions: { read: " " } } })).rejects.toThrow(/must declare an authorization permission/);
  });

  it("contributes the domain with its builder and risk slice", () => {
    expect(contributePaymentsTools()).toEqual({ domain: PAYMENTS_TOOLS_DOMAIN, build: buildPaymentsToolRegistrations, risk: paymentsToolsDerivedRisk });
  });
});

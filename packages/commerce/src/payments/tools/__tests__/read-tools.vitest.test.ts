import { ToolInputError, ToolPermissionDeniedError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import { PAYMENTS_TOOL_IDS } from "../index.js";
import { LIPAY, paidLipay } from "../../ops/__tests__/harness.js";
import { toolWorld } from "./harness.js";

const GET = PAYMENTS_TOOL_IDS.get;
const LIST = PAYMENTS_TOOL_IDS.listProviders;

describe("commerce_payments_get", () => {
  it("returns the service's view of a payment in the run's scope, after the read check", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    const result = await t.call(GET, { paymentId: payment.id });
    expect(result).toEqual({ ok: true, payment });
    expect(t.authorized).toEqual([{ principalId: "admin-1", permission: "commerce.payments.read", workspaceId: "ws", entityType: "payment", entityId: payment.id }]);
  });

  it("answers not-found for a payment outside the run's scope", async () => {
    const t = await toolWorld();
    const payment = await paidLipay(t.w);
    t.host.scope = { ...LIPAY, siteId: "other-site" };
    expect(await t.call(GET, { paymentId: payment.id })).toEqual({ ok: false, reason: "payment-not-found", message: expect.stringContaining(payment.id) });
  });

  it("refuses without a payment scope and checks no permission", async () => {
    const t = await toolWorld();
    t.host.scope = null;
    expect(await t.call(GET, { paymentId: "p" })).toMatchObject({ ok: false, reason: "no-payment-scope" });
    expect(t.authorized).toEqual([]);
  });

  it("propagates a permission denial", async () => {
    const t = await toolWorld();
    t.host.allowChecks = 0;
    await expect(t.call(GET, { paymentId: "p" })).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  });

  it("refuses malformed input before resolving anything", async () => {
    const t = await toolWorld();
    for (const input of [undefined, "p", {}, { paymentId: "" }, { paymentId: "   " }, { paymentId: "x".repeat(201) }, { paymentId: 7 }, { paymentId: "p", scope: LIPAY }]) {
      await expect(t.call(GET, input)).rejects.toBeInstanceOf(ToolInputError);
    }
    await expect(t.call(GET, { paymentId: "p", workspaceId: "other" })).rejects.toThrow(/unknown field 'workspaceId'/);
    expect(t.authorized).toEqual([]);
  });
});

describe("commerce_payments_list_providers", () => {
  it("lists the registered providers and their capabilities", async () => {
    const t = await toolWorld();
    expect(await t.call(LIST, {})).toEqual({
      ok: true,
      providers: [
        { id: "lipay", displayName: "LiPay (fake)", refunds: "partial", capture: "auto" },
        { id: "scripted", displayName: "Scripted", refunds: "partial", capture: "manual" },
      ],
    });
    expect(await t.call(LIST, undefined)).toMatchObject({ ok: true });
    expect(t.authorized.map((a) => [a.permission, a.entityId])).toEqual([["commerce.payments.read", undefined], ["commerce.payments.read", undefined]]);
  });

  it("refuses input, a missing scope and a denied permission", async () => {
    const t = await toolWorld();
    await expect(t.call(LIST, { providerId: "lipay" })).rejects.toBeInstanceOf(ToolInputError);
    t.host.scope = null;
    expect(await t.call(LIST, {})).toMatchObject({ ok: false, reason: "no-payment-scope" });
    t.host.scope = LIPAY;
    t.host.allowChecks = 0;
    await expect(t.call(LIST, {})).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  });
});

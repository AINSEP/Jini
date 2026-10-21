import { describe, expect, test } from "vitest";

import { noopAlertPort } from "../../contract/alerts.js";
import { resolveOpsDeps } from "../deps.js";
import { LIPAY, SCRIPTED, paidLipay, world } from "./harness.js";

/** @file The service's read paths and wiring: getPayment (scope-fenced), listProviders, dependency defaults. */

describe("createPaymentsService reads", () => {
  test("getPayment returns the view in its own scope only", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    expect(await w.service.getPayment({ scope: LIPAY, paymentId: paid.id })).toEqual(paid);
    expect(await w.service.getPayment({ scope: { ...LIPAY, siteId: "other" }, paymentId: paid.id })).toBeNull();
    expect(await w.service.getPayment({ scope: { ...LIPAY, mode: "live" }, paymentId: paid.id })).toBeNull();
    expect(await w.service.getPayment({ scope: LIPAY, paymentId: "nope" })).toBeNull();
    expect(await w.service.getPayment({ scope: { ...LIPAY, providerAccountId: "" }, paymentId: paid.id })).toBeNull();
  });

  test("listProviders summarizes every registered provider", async () => {
    const w = await world({ scripted: { refunds: "full" } });
    expect(w.service.listProviders()).toEqual([
      { id: "lipay", displayName: "LiPay (fake)", refunds: "partial", capture: "auto" },
      { id: "scripted", displayName: "Scripted", refunds: "full", capture: "manual" },
    ]);
    expect(SCRIPTED.providerId).toBe("scripted");
  });
});

describe("resolveOpsDeps", () => {
  test("defaults: no risk gate, alerts dropped; the writer shares the clock, ids and alert sink", () => {
    const required = { ledger: {} as never, providers: {} as never, contexts: {} as never, grants: {} as never, now: () => 1, newId: () => "x" };
    const deps = resolveOpsDeps(required);
    expect(deps.risk).toBeNull();
    expect(deps.alerts).toBe(noopAlertPort);
    expect(deps.writer).toEqual({ now: required.now, newId: required.newId, alerts: noopAlertPort });
  });
});

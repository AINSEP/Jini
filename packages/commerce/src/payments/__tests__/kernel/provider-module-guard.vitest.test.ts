import { describe, expect, test } from "vitest";
import { paymentProviderModuleProblem } from "../../provider-module-guard.js";

const fn = async () => ({ kind: "rejected" });
const caps = { refunds: "none", capture: "auto", void: false, disputes: false, retrieve: "none", echoesCorrelation: false, confirmation: ["none"], currencies: "any" };
const provider = (capabilities: Record<string, unknown>, methods: Record<string, unknown> = {}) =>
  ({ id: "p", displayName: "P", credentialKeys: [], createIntent: fn, verifyWebhook: fn, capabilities: { ...caps, ...capabilities }, ...methods });

describe("capability values and promised methods are checked at load", () => {
  test("a minimal valid provider passes", () => expect(paymentProviderModuleProblem(provider({}))).toBeUndefined());
  test.each([
    [{ refunds: "some" }, 'capabilities.refunds must be "none" | "full" | "partial"'],
    [{ capture: "later" }, 'capabilities.capture must be "auto" | "manual"'],
    [{ void: "yes" }, "capabilities.void must be a boolean"],
    [{ disputes: 1 }, "capabilities.disputes must be a boolean"],
    [{ retrieve: "all" }, 'capabilities.retrieve must be "none" | "payment" | "payment+refunds"'],
    [{ echoesCorrelation: undefined }, "capabilities.echoesCorrelation must be a boolean"],
    [{ confirmation: "none" }, "capabilities.confirmation must be an array of strings"],
    [{ currencies: 5 }, 'capabilities.currencies must be "any" or an array of strings'],
  ])("%o is refused", (bad, message) => expect(paymentProviderModuleProblem(provider(bad))).toBe(message));
  test("an array of currency codes is accepted", () => expect(paymentProviderModuleProblem(provider({ currencies: ["USD"] }))).toBeUndefined());
  test.each([
    [{ refunds: "partial" }, "refund"],
    [{ capture: "manual" }, "capture"],
    [{ void: true }, "void"],
    [{ retrieve: "payment" }, "retrieve"],
  ])("%o without its method is refused", (promise, method) => {
    expect(paymentProviderModuleProblem(provider(promise))).toMatch(new RegExp(`but ${method}\\(\\) is missing$`));
    expect(paymentProviderModuleProblem(provider(promise, { [method]: fn }))).toBeUndefined();
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { activateLipay } from "../lipay-plugin.js";
import { InMemoryPaymentCredentials } from "../credentials.js";
/** Preparation errors remain the host's explicit refusal, before providers or SQL can run. */
test("payment preparation failure never enters the kernel or outbound HTTP", async () => {
  const fault = new Error("storage not approved");
  const kernel = { run: () => { assert.fail("SQL must not start after refused preparation"); } } as unknown as Parameters<typeof activateLipay>[0]["kernel"];
  await assert.rejects(activateLipay({
    kernel, prepareStorage: async () => { throw fault; }, workspaceId: "shop", providers: [],
    credentials: new InMemoryPaymentCredentials(), httpClient: { send: async () => { assert.fail("HTTP must not start after refused preparation"); } },
    clock: { now: () => 0 }, idGen: { newId: () => "unused" }, webhookBaseUrl: "https://shop.test", returnUrl: "https://shop.test/return",
  }), error => error === fault);
});

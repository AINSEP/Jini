/**
 * @file Both `PaymentCredentialsPort` adapters, and the derivation rule that makes adding a
 * provider a config change rather than a code change.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { credentialEnvVarName, EnvPaymentCredentials, InMemoryPaymentCredentials } from "../credentials.js";
import { WORKSPACE_ID } from "./support.js";

test("credentials: env var names are DERIVED from the provider's declared keys, never mapped", () => {
  assert.equal(credentialEnvVarName({ providerId: "lipay", key: "secretKey" }), "JINI_PAYMENT_LIPAY_SECRET_KEY");
  assert.equal(credentialEnvVarName({ providerId: "lipay", key: "webhookSecret" }), "JINI_PAYMENT_LIPAY_WEBHOOK_SECRET");
  assert.equal(credentialEnvVarName({ providerId: "stripe", key: "secretKey" }), "JINI_PAYMENT_STRIPE_SECRET_KEY");
  // A hyphenated regional provider id survives the derivation intact.
  assert.equal(credentialEnvVarName({ providerId: "m-pesa", key: "consumerSecret" }), "JINI_PAYMENT_M_PESA_CONSUMER_SECRET");
  assert.equal(credentialEnvVarName({ providerId: "lipay", key: "shortcode" }), "JINI_PAYMENT_LIPAY_SHORTCODE");
});

test("credentials: the env adapter resolves a whole bundle from derived names", async () => {
  const port = new EnvPaymentCredentials({
    env: {
      JINI_PAYMENT_LIPAY_SECRET_KEY: " sk_live ",
      JINI_PAYMENT_LIPAY_WEBHOOK_SECRET: "whsec_live",
    },
  });

  const bundle = await port.getCredentials({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    keys: ["secretKey", "webhookSecret"],
  });

  assert.deepEqual(bundle, { secretKey: "sk_live", webhookSecret: "whsec_live" });
});

test("credentials: a half-configured provider resolves to null, not a partial bundle", async () => {
  const port = new EnvPaymentCredentials({ env: { JINI_PAYMENT_LIPAY_SECRET_KEY: "sk_live" } });

  assert.equal(
    await port.getCredentials({ workspaceId: WORKSPACE_ID, providerId: "lipay", keys: ["secretKey", "webhookSecret"] }),
    null
  );
  // A blank value is a missing value; an empty signing secret would otherwise verify nothing.
  const blank = new EnvPaymentCredentials({ env: { JINI_PAYMENT_LIPAY_SECRET_KEY: "   " } });
  assert.equal(await blank.getCredentials({ workspaceId: WORKSPACE_ID, providerId: "lipay", keys: ["secretKey"] }), null);
});

test("credentials: an unconfigured provider resolves to null on both adapters", async () => {
  const env = new EnvPaymentCredentials({ env: {} });
  const memory = new InMemoryPaymentCredentials();
  const request = { workspaceId: WORKSPACE_ID, providerId: "stripe", keys: ["secretKey"] };

  assert.equal(await env.getCredentials(request), null);
  assert.equal(await memory.getCredentials(request), null);
});

test("credentials: the in-memory double is settable and clearable per test", async () => {
  const port = new InMemoryPaymentCredentials({ lipay: { secretKey: "sk", webhookSecret: "wh" } });
  const request = { workspaceId: WORKSPACE_ID, providerId: "lipay", keys: ["secretKey", "webhookSecret"] };

  assert.deepEqual(await port.getCredentials(request), { secretKey: "sk", webhookSecret: "wh" });

  port.set({ providerId: "lipay", bundle: null });
  assert.equal(await port.getCredentials(request), null);

  port.set({ providerId: "lipay", bundle: { secretKey: "sk2", webhookSecret: "wh2" } });
  assert.deepEqual(await port.getCredentials(request), { secretKey: "sk2", webhookSecret: "wh2" });
});

test("credentials: only the declared keys are returned — a provider cannot read a peer's slots", async () => {
  const port = new InMemoryPaymentCredentials({
    lipay: { secretKey: "sk", webhookSecret: "wh", unrelated: "should-not-leak" },
  });

  const bundle = await port.getCredentials({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    keys: ["secretKey"],
  });

  assert.deepEqual(bundle, { secretKey: "sk" });
});

test("credentials: the port carries workspaceId today even though env resolution is install-wide", async () => {
  const port = new EnvPaymentCredentials({ env: { JINI_PAYMENT_LIPAY_SECRET_KEY: "sk_live" } });
  const keys = ["secretKey"];

  // Deferred behavior, asserted so the deferral is visible rather than assumed: the parameter
  // exists for a later sealed per-workspace adapter; the env adapter ignores it by design.
  assert.deepEqual(await port.getCredentials({ workspaceId: "workspace-a", providerId: "lipay", keys }), {
    secretKey: "sk_live",
  });
  assert.deepEqual(await port.getCredentials({ workspaceId: "workspace-b", providerId: "lipay", keys }), {
    secretKey: "sk_live",
  });
});


test("credentials: the production env adapter reads process.env when no options are passed", async () => {
  const values = { JINI_PAYMENT_LIPAY_SECRET_KEY: " sk_process ", JINI_PAYMENT_LIPAY_WEBHOOK_SECRET: "whsec_process" };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    assert.deepEqual(await new EnvPaymentCredentials().getCredentials({ workspaceId: WORKSPACE_ID, providerId: "lipay", keys: ["secretKey", "webhookSecret"] }), { secretKey: "sk_process", webhookSecret: "whsec_process" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("credentials: a host prefix keeps its existing environment namespace", async () => {
  const port = new EnvPaymentCredentials({ prefix: "TOVU_PAYMENT", env: { TOVU_PAYMENT_LIPAY_SECRET_KEY: " host-test-key " } });
  assert.equal(credentialEnvVarName({ providerId: "lipay", key: "secretKey" }, { prefix: "TOVU_PAYMENT" }), "TOVU_PAYMENT_LIPAY_SECRET_KEY");
  assert.deepEqual(await port.getCredentials({ workspaceId: WORKSPACE_ID, providerId: "lipay", keys: ["secretKey"] }), { secretKey: "host-test-key" });
});

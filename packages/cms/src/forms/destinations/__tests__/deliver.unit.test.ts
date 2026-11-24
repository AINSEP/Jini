import assert from "node:assert/strict";
import { test } from "vitest";

import { buildFormDestinationRegistry, FormDeliveryError, type FormDeliveryJob, type FormDestinationKit, type FormDestinationModule } from "../../index.js";
import { createFormDestinationDeliverer, type ResolveRequestTarget } from "../deliver.js";

/**
 * @file One push-delivery attempt: adapter lookup, credential resolution, and the credential-scoped
 * kit whose `fetch` runs the host-injected `resolveRequestTarget` check before any network call.
 */

const registryWith = (module: FormDestinationModule) => buildFormDestinationRegistry({ refusals: [], loaded: [
  { descriptor: { id: "sheet", label: "Sheet", module: "sheet.mjs" }, pluginId: "p", module },
] });
const job = { binding: { bindingId: "b", adapterId: "sheet", connectionRef: "cred", enabled: true, config: {} }, idempotencyKey: "k", snapshot: {} } as unknown as FormDeliveryJob;
const fetched: string[] = [];
const kit = { fetch: async (url: string) => { fetched.push(url); return new Response("ok"); }, timeouts: {} } as unknown as FormDestinationKit;
const credential = { token: "t", baseUrl: "https://rows.example.com" };
/** Exact-origin stand-in for the host check: refuses any URL outside the described origins. */
const resolveRequestTarget: ResolveRequestTarget = async ({ resolver, input }) => {
  const target = await resolver.describe({ workspaceId: input.workspaceId, label: input.label });
  const origins = [target!.baseUrl, ...target!.additionalHosts].map((u) => new URL(u).origin);
  if (!origins.includes(new URL(String(input.url)).origin)) throw new Error(`refused ${String(input.url)}`);
  return { url: input.url };
};
const code = (err: unknown) => (err instanceof FormDeliveryError ? err.code : err);

test("the adapter's kit fetch reaches the credential's origin and refuses any other with a safe code", async () => {
  let outcome: unknown;
  const deliver = createFormDestinationDeliverer({ resolveRequestTarget, kit, connections: async () => credential, loadRegistry: async () => registryWith({
    deliver: async ({ kit: scoped }) => {
      await scoped.fetch("https://rows.example.com/append", {}, { timeoutMs: 1000 });
      outcome = await scoped.fetch("https://evil.example.net/?a=answers", {}, { timeoutMs: 1000 }).catch(code);
    },
  }) });
  await deliver({ workspaceId: "w", job });
  assert.deepEqual(fetched, ["https://rows.example.com/append"]);
  assert.equal(outcome, "configuration-invalid");
});

test("a missing adapter is retryable and a missing credential is not", async () => {
  const none = createFormDestinationDeliverer({ resolveRequestTarget, kit, connections: async () => credential, loadRegistry: async () => buildFormDestinationRegistry({ refusals: [], loaded: [] }) });
  assert.equal(await none({ workspaceId: "w", job }).catch(code), "adapter-unavailable");
  const noCred = createFormDestinationDeliverer({ resolveRequestTarget, kit, connections: async () => null, loadRegistry: async () => registryWith({ deliver: async () => undefined }) });
  assert.equal(await noCred({ workspaceId: "w", job }).catch(code), "authorization-required");
});

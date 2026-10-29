import { ForbiddenError } from "@jini-ai/cms/core";
import { describe, expect, test } from "vitest";
import {
  CommerceCheckoutValidationError, CommerceOrderNotFoundError, CommercePriceNotFoundError,
  CommerceProductNotFoundError, readCommerceStatus,
} from "../../../index.js";
import type { CommercePaymentProvider } from "../../../index.js";
import { buildRegistrations, catalog, contributeCommerceGetStatusTools, derivedRisk } from "../../../tools.js";

const provider: CommercePaymentProvider = { id: "regional", displayName: "Regional Pay", capabilities: {
  refunds: "partial", tokenization: true, recurring: false, confirmation: ["redirect", "out_of_band"],
  currencies: ["KES", "USD"], webhooks: true,
} };
const unavailable = { status: "unavailable", reason: "No payment runtime is composed for this workspace." };
const configuration = { status: "unavailable", schema: null, reason: "The payment runtime does not expose a provider configuration contract." };
const capabilities = { providerDiscovery: "unavailable", checkout: "unavailable", subscriptions: "unavailable",
  webhookReconciliation: "unavailable", revenue: "unavailable" };
const context = { executionId: "exec-a", principal: { id: "operator-a" }, run: { id: "run-a" }, input: {}, signal: new AbortController().signal };

describe("public status snapshot", () => {
  test("an absent runtime reports a complete unavailable contract", () => {
    expect(readCommerceStatus({ workspaceId: "ws-a", resolvePaymentRuntime: () => null })).toEqual({
      contractVersion: 1, workspaceId: "ws-a", paymentRuntime: unavailable, providers: [], configuration, capabilities,
    });
  });

  test("a composed runtime with no providers still reports available discovery without operational readiness", () => {
    expect(readCommerceStatus({ workspaceId: "ws-a", resolvePaymentRuntime: () => ({ listProviders: () => [] }) })).toEqual({
      contractVersion: 1, workspaceId: "ws-a", paymentRuntime: { status: "available", reason: null }, providers: [],
      configuration, capabilities: { ...capabilities, providerDiscovery: "available" },
    });
  });

  test("runtime provider discovery detaches mutable arrays and omits adapter internals", () => {
    const registry = [{ ...provider, secret: "never expose", capabilities: { ...provider.capabilities, secret: "never expose" } },
      { id: "global", displayName: "Global Pay", capabilities: { refunds: "none" as const, tokenization: false,
        recurring: true, confirmation: ["none" as const], currencies: "any" as const, webhooks: false } }];
    const input = { workspaceId: "ws-a", resolvePaymentRuntime: () => ({ listProviders: () => registry }) };
    const first = readCommerceStatus(input);
    expect(first).toEqual({ contractVersion: 1, workspaceId: "ws-a", paymentRuntime: { status: "available", reason: null },
      providers: [provider, { id: "global", displayName: "Global Pay", capabilities: { refunds: "none", tokenization: false,
        recurring: true, confirmation: ["none"], currencies: "any", webhooks: false } }],
      configuration, capabilities: { ...capabilities, providerDiscovery: "available" } });
    // Mutate the returned JSON read model as a consumer could; a subsequent read must be intact.
    (first.providers[0]!.capabilities.confirmation as string[]).push("client_action");
    (first.providers[0]!.capabilities.currencies as string[]).push("EUR");
    (first.configuration as { reason: string }).reason = "consumer edited";
    expect(readCommerceStatus(input).providers[0]).toEqual(provider);
    expect(readCommerceStatus(input).configuration).toEqual(configuration);
    expect(registry[0]!.capabilities.confirmation).toEqual(["redirect", "out_of_band"]);
    expect(registry[0]!.capabilities.currencies).toEqual(["KES", "USD"]);
  });

  test.each([new Error("registry failed"), "registry failed"])("resolver and provider failures propagate unchanged: %s", fault => {
    for (const resolvePaymentRuntime of [() => { throw fault; }, () => ({ listProviders: () => { throw fault; } })]) {
      let caught: unknown;
      try { readCommerceStatus({ workspaceId: "ws-a", resolvePaymentRuntime }); }
      catch (error) { caught = error; }
      expect(caught).toBe(fault);
    }
  });
});

describe("commerce status tool contribution", () => {
  test("the complete catalog declares an empty read-only input and the integration permission", () => {
    expect(catalog).toEqual([{ name: "commerce_get_status",
      description: "Checks store and commerce setup status and available payment providers. Call to ask whether checkout, subscriptions, webhooks or revenue reporting are supported yet. Returns {contractVersion, workspaceId, paymentRuntime, providers, configuration, capabilities}, with unavailable capabilities explicitly marked. Read-only: no payments or credentials are read or changed. Provider discovery alone does not mean checkout is configured.",
      sideEffects: "none", authorization: { permission: "admin.integrations.manage" },
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    }]);
    expect([...derivedRisk]).toEqual([["commerce_get_status", "none"]]);
    const contribution = contributeCommerceGetStatusTools();
    expect(contribution.domain).toBe("commerce-get-status");
    expect(contribution.build).toBe(buildRegistrations);
    expect(contribution.risk).toBe(derivedRisk);
    const registrations = contribution.build({ workspaceId: "ws-a", authorize: async () => ({ allowed: true, reason: "matched" }) });
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.descriptor).toMatchObject({ id: "commerce_get_status", readOnly: true, sideEffects: "none",
      inputSchema: { type: "object", additionalProperties: false, properties: {} } });
  });

  test("permission denial prevents provider discovery and includes permission and reason", async () => {
    let discovered = false;
    const requests: unknown[] = [];
    const [registration] = buildRegistrations({ workspaceId: "ws-a", authorize: async request => {
      requests.push(request); return { allowed: false, reason: "insufficient_permission" };
    }, lipay: { listProviders: () => { discovered = true; return [provider]; } } });
    await expect(registration!.handler(context)).rejects.toMatchObject({ constructor: ForbiddenError,
      message: "principal 'operator-a' is not authorized for 'admin.integrations.manage' (insufficient_permission)",
      permission: "admin.integrations.manage", reason: "insufficient_permission" });
    expect(discovered).toBe(false);
    expect(requests).toEqual([{ principalId: "operator-a", workspaceId: "ws-a", permission: "admin.integrations.manage", entityType: "integration" }]);
  });

  test("permission is awaited on every invocation before resolving the current runtime", async () => {
    let allow!: (value: { allowed: boolean; reason: string }) => void;
    let discovered = 0;
    const deps: Parameters<typeof buildRegistrations>[0] = { workspaceId: "ws-a", authorize: () => new Promise(resolve => { allow = resolve; }),
      lipay: { listProviders: () => { discovered++; return [provider]; } } };
    const [registration] = buildRegistrations(deps);
    const first = registration!.handler(context);
    expect(discovered).toBe(0);
    allow({ allowed: true, reason: "matched" });
    await expect(first).resolves.toMatchObject({ workspaceId: "ws-a", paymentRuntime: { status: "available", reason: null }, providers: [provider] });
    deps.lipay = undefined;
    const second = registration!.handler(context);
    allow({ allowed: true, reason: "matched" });
    await expect(second).resolves.toEqual({ contractVersion: 1, workspaceId: "ws-a", paymentRuntime: unavailable,
      providers: [], configuration, capabilities });
    expect(discovered).toBe(1);
  });

  test("authorization failures propagate before provider code is entered", async () => {
    const fault = new Error("authorization unavailable");
    let discovered = false;
    const [registration] = buildRegistrations({ workspaceId: "ws-a", authorize: async () => { throw fault; },
      lipay: { listProviders: () => { discovered = true; return []; } } });
    await expect(registration!.handler(context)).rejects.toBe(fault);
    expect(discovered).toBe(false);
  });
});

test("root error exports preserve the domain type, message and validation field details", () => {
  for (const ErrorClass of [CommerceProductNotFoundError, CommercePriceNotFoundError, CommerceOrderNotFoundError]) {
    const error = new ErrorClass("missing record");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.message).toBe("missing record");
  }
  expect(new CommerceCheckoutValidationError({ message: "invalid" })).toMatchObject({ message: "invalid", fieldErrors: [] });
  expect(new CommerceCheckoutValidationError({ message: "invalid", fieldErrors: [{ field: "quantity", reason: "too large" }] }))
    .toMatchObject({ message: "invalid", fieldErrors: [{ field: "quantity", reason: "too large" }] });
});

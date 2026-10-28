/**
 * Proves item 10 of the commerce design: a payment provider plugin registers ONLY through
 * agent-plugins' trusted executable-contribution loader, and the host keeps the trust decision.
 * The loader and `defineExecutablePluginContribution` are the real ones; only their I/O ports
 * (package discovery, file reads, module import) are in-memory fakes.
 */
import { describe, expect, it } from "vitest";
import {
  createPluginContributionLoader,
  defineExecutablePluginContribution,
  type PluginContributionPorts,
  type TrustedPluginVerdict,
} from "@jini-ai/agent-plugins/lifecycle";
import type { PaymentProvider } from "../../contract/provider.js";
import {
  PAYMENT_PROVIDER_EXTENSION_NAMESPACE,
  parsePaymentProviderManifest,
  paymentProviderContributionSpec,
  type PaymentProviderDescriptor,
} from "../../plugin-contribution.js";
import { isPaymentProviderModule, paymentProviderModuleProblem } from "../../provider-module-guard.js";

const plugin = { pluginId: "acme-pay", packageRoot: "/plugins/acme-pay" };

function fakeProvider(overrides: Record<string, unknown> = {}): PaymentProvider {
  return {
    id: "acme",
    displayName: "Acme Pay",
    capabilities: { refunds: "none", capture: "auto", void: false, disputes: false, retrieve: "none", echoesCorrelation: false, confirmation: ["none"], currencies: "any" },
    credentialKeys: ["secretKey"],
    createIntent: async () => ({ kind: "rejected", error: { code: "DECLINED", message: "fake", retryable: false } }),
    verifyWebhook: async () => ({ kind: "ok", value: [] }),
    ...overrides,
  } as PaymentProvider;
}

const manifest = (namespace: unknown) => JSON.stringify({ name: "acme-pay", extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: namespace } });

function harness(required: { verdicts: readonly TrustedPluginVerdict[]; raw: string; exported?: unknown }) {
  const reads: string[] = [];
  const imports: string[] = [];
  const ports: PluginContributionPorts = {
    findPackages: async () => required.verdicts,
    readFile: async ({ plugin: p, filename }) => {
      reads.push(`${p.pluginId}/${filename}`);
      return required.raw;
    },
    importModule: async ({ plugin: p, modulePath }) => {
      imports.push(`${p.pluginId}/${modulePath}`);
      return { exported: required.exported };
    },
  };
  const definition = defineExecutablePluginContribution(paymentProviderContributionSpec({}));
  const loader = createPluginContributionLoader(ports);
  return { reads, imports, load: (options = {}) => loader.loadPluginContributions({ workspaceId: "ws", definition }, options) };
}

describe("payment provider plugins register through the trusted contribution loader", () => {
  it("loads a trusted plugin's declared provider module, validated, with its plugin id", async () => {
    const provider = fakeProvider();
    const h = harness({ verdicts: [{ trusted: plugin }], raw: manifest({ providers: [{ module: "./acme.js" }] }), exported: provider });
    const result = await h.load();
    expect(result).toEqual({ items: [{ descriptor: { module: "./acme.js" }, pluginId: "acme-pay", module: provider }], refusals: [] });
    expect(h.reads).toEqual(["acme-pay/plugin.json"]);
    expect(h.imports).toEqual(["acme-pay/./acme.js"]);
  });

  it("an untrusted verdict is refused before plugin.json is read or any code is imported", async () => {
    const h = harness({ verdicts: [{ refusal: "payment providers from 'acme-pay' were not loaded: plugin is not trusted" }], raw: manifest({ provider: "./acme.js" }), exported: fakeProvider() });
    const result = await h.load();
    expect(result).toEqual({ items: [], refusals: ["payment providers from 'acme-pay' were not loaded: plugin is not trusted"] });
    expect(h.reads).toEqual([]);
    expect(h.imports).toEqual([]);
  });

  it("host revocation (packageRefusal) refuses a trusted plugin and loads no provider", async () => {
    const h = harness({ verdicts: [{ trusted: plugin }], raw: manifest({ provider: "./acme.js" }), exported: fakeProvider() });
    const result = await h.load({ packageRefusal: ({ plugin: p }: { plugin: { pluginId: string } }) => (p.pluginId === "acme-pay" ? "revoked by host" : undefined) });
    expect(result).toEqual({ items: [], refusals: ["revoked by host"] });
    expect(h.imports).toEqual([]);
  });

  it("a module failing validation is refused with the guard's reason", async () => {
    const h = harness({ verdicts: [{ trusted: plugin }], raw: manifest({ provider: "./acme.js" }), exported: fakeProvider({ verifyWebhook: "nope" }) });
    expect(await h.load()).toEqual({
      items: [],
      refusals: ["payment provider './acme.js' from 'acme-pay' was not loaded: verifyWebhook must be a function"],
    });
  });

  it("malformed plugin.json is refused and imports nothing", async () => {
    const h = harness({ verdicts: [{ trusted: plugin }], raw: "{not json", exported: fakeProvider() });
    expect(await h.load()).toEqual({
      items: [],
      refusals: ["payment providers from 'acme-pay' were not loaded: plugin.json is invalid: not valid JSON"],
    });
    expect(h.imports).toEqual([]);
  });

  it("a plugin without the commerce namespace contributes nothing and is not refused", async () => {
    const h = harness({ verdicts: [{ trusted: plugin }], raw: JSON.stringify({ name: "other" }), exported: fakeProvider() });
    expect(await h.load()).toEqual({ items: [], refusals: [] });
    expect(h.imports).toEqual([]);
  });

  it("honors a host-chosen manifest filename", () => {
    expect(paymentProviderContributionSpec({}, { filename: "commerce.json" }).filename).toBe("commerce.json");
    expect(paymentProviderContributionSpec({}).contribution).toBe("payment providers");
  });
});

describe("parsePaymentProviderManifest", () => {
  const ok = (descriptors: PaymentProviderDescriptor[]) => ({ ok: true, descriptors });
  const fail = (reason: string) => ({ ok: false, reason });

  it.each([
    ["the providers array", manifest({ providers: [{ module: "./a.js" }, { module: "./b.js" }] }), ok([{ module: "./a.js" }, { module: "./b.js" }])],
    ["the provider shorthand", manifest({ provider: "./a.js" }), ok([{ module: "./a.js" }])],
    ["providers over the shorthand", manifest({ providers: [], provider: "./a.js" }), ok([])],
    ["no extensions", JSON.stringify({}), ok([])],
    ["another namespace only", JSON.stringify({ extensions: { "ai.other": {} } }), ok([])],
  ])("accepts %s", (_label, raw, expected) => {
    expect(parsePaymentProviderManifest({ raw })).toEqual(expected);
  });

  it.each([
    ["invalid JSON", "{", "not valid JSON"],
    ["a non-object manifest", "[]", "the manifest must be a JSON object"],
    ["a null manifest", "null", "the manifest must be a JSON object"],
    ["non-object extensions", JSON.stringify({ extensions: [] }), "extensions must be an object"],
    ["a non-object namespace", manifest("./a.js"), "extensions.ai.jini.commerce must be an object"],
    ["a non-array providers", manifest({ providers: "./a.js" }), "ai.jini.commerce.providers must be an array"],
    ["a provider entry without module", manifest({ providers: [{ module: "./a.js" }, {}] }), "ai.jini.commerce.providers[1].module must be a non-empty string"],
    ["a blank provider module", manifest({ providers: [{ module: "  " }] }), "ai.jini.commerce.providers[0].module must be a non-empty string"],
    ["a non-object provider entry", manifest({ providers: ["./a.js"] }), "ai.jini.commerce.providers[0].module must be a non-empty string"],
    ["a non-string shorthand", manifest({ provider: 7 }), "extensions.ai.jini.commerce needs a providers array or a provider module string"],
    ["an empty namespace", manifest({}), "extensions.ai.jini.commerce needs a providers array or a provider module string"],
  ])("refuses %s", (_label, raw, reason) => {
    expect(parsePaymentProviderManifest({ raw })).toEqual(fail(reason));
  });

  it.each([
    ["null extensions", { extensions: null }, "extensions must be an object"],
    ["a null namespace", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: null } }, "extensions.ai.jini.commerce must be an object"],
    ["an array namespace", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: [] } }, "extensions.ai.jini.commerce must be an object"],
    ["null providers despite a valid shorthand", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: { providers: null, provider: "./fallback.js" } } }, "ai.jini.commerce.providers must be an array"],
    ["a null entry", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: { providers: [null] } } }, "ai.jini.commerce.providers[0].module must be a non-empty string"],
    ["an array entry", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: { providers: [[]] } } }, "ai.jini.commerce.providers[0].module must be a non-empty string"],
    ["a numeric module", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: { providers: [{ module: 1 }] } } }, "ai.jini.commerce.providers[0].module must be a non-empty string"],
    ["a blank shorthand", { extensions: { [PAYMENT_PROVIDER_EXTENSION_NAMESPACE]: { provider: " \t " } } }, "extensions.ai.jini.commerce needs a providers array or a provider module string"],
  ])("refuses %s without silently falling back", (_name, value, reason) => {
    expect(parsePaymentProviderManifest({ raw: JSON.stringify(value) })).toEqual({ ok: false, reason });
  });

  it("one malformed provider declaration refuses the entire list before any module is imported", async () => {
    const h = harness({ verdicts: [{ trusted: plugin }], raw: manifest({ providers: [{ module: "./valid.js" }, { module: "" }] }), exported: fakeProvider() });
    expect(await h.load()).toEqual({
      items: [],
      refusals: ["payment providers from 'acme-pay' were not loaded: plugin.json is invalid: ai.jini.commerce.providers[1].module must be a non-empty string"],
    });
    expect(h.imports).toEqual([]);
  });
});

describe("isPaymentProviderModule / paymentProviderModuleProblem", () => {
  it("accepts a minimal provider and one with every optional method", () => {
    expect(isPaymentProviderModule(fakeProvider())).toBe(true);
    const fn = async () => ({ kind: "ok", value: {} });
    expect(isPaymentProviderModule(fakeProvider({ refund: fn, capture: fn, void: fn, retrieve: fn }))).toBe(true);
  });

  it.each([
    ["null", null, "its module's default export is not an object"],
    ["an array", [], "its module's default export is not an object"],
    ["a function", () => undefined, "its module's default export is not an object"],
    ["a missing id", fakeProvider({ id: undefined }), "id must be a non-empty string"],
    ["an empty id", fakeProvider({ id: "" }), "id must be a non-empty string"],
    ["a non-string displayName", fakeProvider({ displayName: 1 }), "displayName must be a string"],
    ["non-object capabilities", fakeProvider({ capabilities: "all" }), "capabilities must be an object"],
    ["non-array credentialKeys", fakeProvider({ credentialKeys: "secretKey" }), "credentialKeys must be an array of strings"],
    ["non-string credential keys", fakeProvider({ credentialKeys: [1] }), "credentialKeys must be an array of strings"],
    ["a missing createIntent", fakeProvider({ createIntent: undefined }), "createIntent must be a function"],
    ["a missing verifyWebhook", fakeProvider({ verifyWebhook: undefined }), "verifyWebhook must be a function"],
    ["a non-function refund", fakeProvider({ refund: {} }), "refund must be a function when present"],
    ["a non-function capture", fakeProvider({ capture: 1 }), "capture must be a function when present"],
    ["a non-function void", fakeProvider({ void: true }), "void must be a function when present"],
    ["a non-function retrieve", fakeProvider({ retrieve: "payment" }), "retrieve must be a function when present"],
  ])("rejects %s", (_label, value, reason) => {
    expect(paymentProviderModuleProblem(value)).toBe(reason);
    expect(isPaymentProviderModule(value)).toBe(false);
  });
});

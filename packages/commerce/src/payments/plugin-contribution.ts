/**
 * @file How a payment PROVIDER plugin registers (commerce design 2026-10-21, item 10 / lot L0).
 *
 * A plugin manifest grants no trust on its own, so a provider never registers by being installed:
 * the host passes this spec to `@jini-ai/agent-plugins`'s `defineExecutablePluginContribution` and
 * loads it with `createPluginContributionLoader`. That loader owns every trust decision —
 * activation, shipped-digest verification, on-disk containment of the imported module — and the
 * host's `packageRefusal` hook is where revocation lives. This file owns only what is
 * commerce-specific: where in `plugin.json` providers are declared, and what a provider export
 * must look like.
 *
 * Commerce deliberately does not import `@jini-ai/agent-plugins` (not even its types): the kernel
 * must not depend on the plugin host, so the spec below is typed by local structural mirrors that
 * the host's `defineExecutablePluginContribution` accepts as-is.
 *
 * Declaration in `plugin.json`:
 * `{ "extensions": { "ai.jini.commerce": { "providers": [{ "module": "./stripe.js" }] } } }`, or the
 * single-provider shorthand `{ "provider": "./stripe.js" }`. A plugin without the namespace
 * contributes no providers and is not refused: every plugin ships `plugin.json`.
 */
import type { PaymentProvider } from "./contract/provider.js";
import { paymentProviderModuleProblem } from "./provider-module-guard.js";

/** The `plugin.json` extension namespace commerce reads. */
export const PAYMENT_PROVIDER_EXTENSION_NAMESPACE = "ai.jini.commerce";

/** One declared provider: the module path, relative to the plugin root, whose default export is the provider. */
export interface PaymentProviderDescriptor {
  readonly module: string;
}

/** Structural mirror of agent-plugins' `TrustedPluginPackage`. */
export interface PaymentProviderPluginRef {
  readonly pluginId: string;
  readonly packageRoot: string;
}

/** Structural mirror of agent-plugins' `PluginContributionParseResult`. */
export type PaymentProviderParseResult =
  | { readonly ok: true; readonly descriptors: readonly PaymentProviderDescriptor[] }
  | { readonly ok: false; readonly reason: string };

/** The `required` argument of `defineExecutablePluginContribution<PaymentProviderDescriptor, PaymentProvider>`. */
export interface PaymentProviderContributionSpec {
  readonly filename: string;
  readonly contribution: string;
  readonly parse: (input: { readonly raw: string }) => PaymentProviderParseResult;
  readonly modulePath: (input: { readonly descriptor: PaymentProviderDescriptor }) => string;
  readonly validate: (input: { readonly exported: unknown }) => PaymentProvider | string;
  readonly refusal: (input: {
    readonly plugin: PaymentProviderPluginRef;
    readonly descriptor: PaymentProviderDescriptor;
    readonly reason: string;
  }) => string;
}

type JsonObject = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isModulePath = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const fail = (reason: string): PaymentProviderParseResult => ({ ok: false, reason });

function parseJson(raw: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return undefined;
  }
}

/** The `providers` array form: every entry must be `{ module: <non-empty string> }`. */
function parseProviderList(providers: unknown): PaymentProviderParseResult {
  if (!Array.isArray(providers)) return fail(`${PAYMENT_PROVIDER_EXTENSION_NAMESPACE}.providers must be an array`);
  const descriptors: PaymentProviderDescriptor[] = [];
  for (const [index, entry] of providers.entries()) {
    if (!isRecord(entry) || !isModulePath(entry.module)) {
      return fail(`${PAYMENT_PROVIDER_EXTENSION_NAMESPACE}.providers[${index}].module must be a non-empty string`);
    }
    descriptors.push({ module: entry.module });
  }
  return { ok: true, descriptors };
}

/** The namespace body: `providers` wins; `provider` is the single-module shorthand. */
function parseNamespace(namespace: unknown): PaymentProviderParseResult {
  if (!isRecord(namespace)) return fail(`extensions.${PAYMENT_PROVIDER_EXTENSION_NAMESPACE} must be an object`);
  if (namespace.providers !== undefined) return parseProviderList(namespace.providers);
  if (isModulePath(namespace.provider)) return { ok: true, descriptors: [{ module: namespace.provider }] };
  return fail(`extensions.${PAYMENT_PROVIDER_EXTENSION_NAMESPACE} needs a providers array or a provider module string`);
}

/**
 * Parse `plugin.json` text into provider declarations. Malformed JSON or a malformed commerce
 * namespace is a refusal; a manifest without the namespace declares nothing.
 * @complexity O(n) for n declared providers.
 */
export function parsePaymentProviderManifest(
  { raw }: { readonly raw: string },
  _optional: Record<string, never> = {}
): PaymentProviderParseResult {
  const parsed = parseJson(raw);
  if (parsed === undefined) return fail("not valid JSON");
  if (!isRecord(parsed.value)) return fail("the manifest must be a JSON object");
  const { extensions } = parsed.value;
  if (extensions === undefined) return { ok: true, descriptors: [] };
  if (!isRecord(extensions)) return fail("extensions must be an object");
  if (!Object.hasOwn(extensions, PAYMENT_PROVIDER_EXTENSION_NAMESPACE)) return { ok: true, descriptors: [] };
  return parseNamespace(extensions[PAYMENT_PROVIDER_EXTENSION_NAMESPACE]);
}

/** The export as a provider, or the reason it is not one. */
function validatePaymentProvider({ exported }: { readonly exported: unknown }): PaymentProvider | string {
  return paymentProviderModuleProblem(exported) ?? (exported as PaymentProvider);
}

/**
 * The `required` argument for `defineExecutablePluginContribution`, so a host registers payment
 * provider plugins through the same trusted loader as every other executable seam.
 * @param _required - Nothing yet; kept for the (required, optional) convention.
 * @param optional.filename - Manifest file at the plugin root (default `plugin.json`).
 * @returns The spec; pass it to `defineExecutablePluginContribution` and load with `createPluginContributionLoader`.
 * @complexity O(1).
 */
export function paymentProviderContributionSpec(
  _required: Record<string, never>,
  optional: { readonly filename?: string } = {}
): PaymentProviderContributionSpec {
  return {
    filename: optional.filename ?? "plugin.json",
    contribution: "payment providers",
    parse: parsePaymentProviderManifest,
    modulePath: ({ descriptor }) => descriptor.module,
    validate: validatePaymentProvider,
    refusal: ({ plugin, descriptor, reason }) =>
      `payment provider '${descriptor.module}' from '${plugin.pluginId}' was not loaded: ${reason}`,
  };
}

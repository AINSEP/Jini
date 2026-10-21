/**
 * @file Structural guard for a payment PROVIDER module's export (commerce design 2026-10-21, L0).
 *
 * A provider arrives as the default export of plugin code the host did not write, so its type
 * annotation proves nothing: this is the runtime check that stands between `import()` and the
 * kernel. It checks shape only (identity, capability object, credential slots, methods); whether
 * the declared capabilities match the methods present is the conformance test-kit's job
 * (`./testkit/provider-conformance.ts`), and whether the plugin is trusted is the host loader's.
 */
import type { PaymentProvider } from "./contract/provider.js";

/** Optional contract methods: each, when present, must be callable. */
export const OPTIONAL_PROVIDER_METHODS = ["refund", "capture", "void", "retrieve"] as const;

type Candidate = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Candidate =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFunction = (value: unknown): boolean => typeof value === "function";
const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Ordered: the first failing check names the problem, so refusals are stable and specific. */
const CHECKS: ReadonlyArray<readonly [(candidate: Candidate) => boolean, string]> = [
  [(c) => typeof c.id === "string" && c.id.length > 0, "id must be a non-empty string"],
  [(c) => typeof c.displayName === "string", "displayName must be a string"],
  [(c) => isRecord(c.capabilities), "capabilities must be an object"],
  [(c) => isStringArray(c.credentialKeys), "credentialKeys must be an array of strings"],
  [(c) => isFunction(c.createIntent), "createIntent must be a function"],
  [(c) => isFunction(c.verifyWebhook), "verifyWebhook must be a function"],
  ...OPTIONAL_PROVIDER_METHODS.map(
    (name) => [(c: Candidate) => c[name] === undefined || isFunction(c[name]), `${name} must be a function when present`] as const
  ),
];

/**
 * Why `value` is not a payment provider module, or `undefined` when it is.
 * @complexity O(k) for k credential keys.
 */
export function paymentProviderModuleProblem(value: unknown, _optional: Record<string, never> = {}): string | undefined {
  if (!isRecord(value)) return "its module's default export is not an object";
  return CHECKS.find(([passes]) => !passes(value))?.[1];
}

/** True when `value` has the runtime shape of a {@link PaymentProvider}. */
export function isPaymentProviderModule(value: unknown, _optional: Record<string, never> = {}): value is PaymentProvider {
  return paymentProviderModuleProblem(value) === undefined;
}

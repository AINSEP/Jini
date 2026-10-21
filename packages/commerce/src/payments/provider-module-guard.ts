/**
 * @file Structural guard for a payment PROVIDER module's export (commerce design 2026-10-21, L0).
 *
 * A provider arrives as the default export of plugin code the host did not write, so its type
 * annotation proves nothing: this is the runtime check that stands between `import()` and the
 * kernel. It checks shape (identity, capability values, credential slots, methods) AND that every
 * operation a capability promises has its method — a provider declaring `capture: "manual"` without
 * `capture()` would otherwise load and make the kernel call `undefined` (L0/L1 review). Behaviour
 * is the conformance test-kit's job (`./testkit/provider-conformance.ts`); trust is the host loader's.
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

const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === "string" && allowed.includes(value);

/** Each capability value's legal range. `currencies` feeds `.includes` in the charge path, so a non-array would throw there. */
const CAPABILITY_CHECKS: ReadonlyArray<readonly [(c: Candidate) => boolean, string]> = [
  [(c) => oneOf(c.refunds, ["none", "full", "partial"]), 'capabilities.refunds must be "none" | "full" | "partial"'],
  [(c) => oneOf(c.capture, ["auto", "manual"]), 'capabilities.capture must be "auto" | "manual"'],
  [(c) => typeof c.void === "boolean", "capabilities.void must be a boolean"],
  [(c) => typeof c.disputes === "boolean", "capabilities.disputes must be a boolean"],
  [(c) => oneOf(c.retrieve, ["none", "payment", "payment+refunds"]), 'capabilities.retrieve must be "none" | "payment" | "payment+refunds"'],
  [(c) => typeof c.echoesCorrelation === "boolean", "capabilities.echoesCorrelation must be a boolean"],
  [(c) => isStringArray(c.confirmation), "capabilities.confirmation must be an array of strings"],
  [(c) => c.currencies === "any" || isStringArray(c.currencies), 'capabilities.currencies must be "any" or an array of strings'],
];

/** Each capability that promises a method, with the method it promises. Shared with the conformance kit. */
export const CAPABILITY_METHOD_RULES: ReadonlyArray<readonly [(typeof OPTIONAL_PROVIDER_METHODS)[number], string, (c: Candidate) => boolean]> = [
  ["refund", 'capabilities.refunds !== "none"', (c) => c.refunds !== "none"],
  ["capture", 'capabilities.capture === "manual"', (c) => c.capture === "manual"],
  ["void", "capabilities.void === true", (c) => c.void === true],
  ["retrieve", 'capabilities.retrieve !== "none"', (c) => c.retrieve !== "none"],
];

function capabilitiesProblem(capabilities: Candidate, candidate: Candidate): string | undefined {
  const bad = CAPABILITY_CHECKS.find(([passes]) => !passes(capabilities));
  if (bad) return bad[1];
  const missing = CAPABILITY_METHOD_RULES.find(([method, , promised]) => promised(capabilities) && !isFunction(candidate[method]));
  return missing ? `${missing[1]} but ${missing[0]}() is missing` : undefined;
}

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
  return CHECKS.find(([passes]) => !passes(value))?.[1] ?? capabilitiesProblem(value.capabilities as Candidate, value);
}

/** True when `value` has the runtime shape of a {@link PaymentProvider}. */
export function isPaymentProviderModule(value: unknown, _optional: Record<string, never> = {}): value is PaymentProvider {
  return paymentProviderModuleProblem(value) === undefined;
}

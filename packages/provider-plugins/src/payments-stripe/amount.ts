import { moneyProblem, type Money } from "@jini-ai/commerce/payments/kernel";

// This conservative list needs no exponent conversion: ISO and Stripe minor units agree.
export const STRIPE_CURRENCIES = ["AUD", "BRL", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HKD",
  "JPY", "KRW", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "USD"] as const;
const supported: ReadonlySet<string> = new Set(STRIPE_CURRENCIES);

/** Encodes supported, nonnegative Money without scaling; invalid input returns null.
 * @complexity O(1) time and space for fixed-size currency codes. */
export function toStripeAmount(
  { money }: { money: Money }, _optional: Record<string, never> = {}
): { amount: number; currency: string } | null {
  if (!supported.has(money.currency) || moneyProblem({ money }, { allowZero: true }) !== null) return null;
  return { amount: money.minorUnits, currency: money.currency.toLowerCase() };
}

/** Decodes untrusted provider minor units into uppercase Money; invalid input returns null.
 * @complexity O(n) time and space in the supplied currency string length. */
export function fromStripeAmount(
  { amount, currency }: { amount: unknown; currency: unknown }, _optional: Record<string, never> = {}
): Money | null {
  if (typeof amount !== "number" || typeof currency !== "string") return null;
  const money = { minorUnits: amount, currency: currency.toUpperCase() };
  return toStripeAmount({ money }) === null ? null : money;
}

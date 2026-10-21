/**
 * @file Money ↔ Stripe's `amount` + `currency` fields.
 *
 * Stripe takes integer amounts in the currency's smallest unit and lowercase currency codes; the
 * kernel keeps integer minor units and UPPERCASE codes, so most currencies pass straight through.
 * The exception is Stripe's documented "special cases" (https://docs.stripe.com/currencies#special-cases):
 * ISK and UGX became zero-decimal, but Stripe still expects them as two-decimal values whose last two
 * digits are `00` (5 ISK → `500`). The kernel's Money already uses ISO exponent 0 for both, so they
 * are scaled by 100 on the way out and back. (Needs a sandbox check before live use.)
 */
import type { Money } from "@jini-ai/commerce/payments/kernel";
import { optionalCount } from "./json.js";

/** Currencies whose Money exponent is 0 but whose Stripe wire amount is two-decimal. */
const LEGACY_TWO_DECIMAL: ReadonlySet<string> = new Set(["ISK", "UGX"]);

const scaleOf = (currency: string): number => (LEGACY_TWO_DECIMAL.has(currency) ? 100 : 1);

/** The `amount` Stripe expects for this Money (smallest Stripe unit). */
export function amountToStripe({ money }: { money: Money }, _optional: Record<string, never> = {}): number {
  return money.minorUnits * scaleOf(money.currency);
}

/** Lowercase on the wire. */
export function currencyToStripe({ money }: { money: Money }, _optional: Record<string, never> = {}): string {
  return money.currency.toLowerCase();
}

/**
 * Money from a Stripe `amount` + `currency` pair, or `undefined` when either is not usable (not a
 * non-negative safe integer, not a three-letter code, or a legacy two-decimal amount not ending `00`).
 * @complexity O(1).
 */
export function moneyFromStripe(
  { amount, currency }: { amount: unknown; currency: unknown },
  _optional: Record<string, never> = {}
): Money | undefined {
  const units = optionalCount(amount);
  if (units === undefined || typeof currency !== "string" || !/^[a-zA-Z]{3}$/.test(currency)) return undefined;
  const code = currency.toUpperCase();
  const scale = scaleOf(code);
  return units % scale === 0 ? { minorUnits: units / scale, currency: code } : undefined;
}

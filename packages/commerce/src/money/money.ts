/**
 * @file Money: integer minor units + UPPERCASE ISO-4217 currency, for the whole package
 * (payments kernel AND catalog). Commerce design 2026-10-21 §6: one representation everywhere,
 * because the catalog's lowercase `"usd"` and the payments kernel's `/^[A-Z]{3}$/` check made a
 * catalog checkout fail the currency rule.
 *
 * `number`, not `bigint`: every amount is checked with `Number.isSafeInteger`, which holds any
 * real-world amount (2^53 minor units ≈ 90 trillion USD). Rows read back from Postgres, where
 * node-pg returns BIGINT as a string, go through the ledger's one safe-integer decoder instead.
 */

export interface Money {
  /** Integer amount in the currency's minor unit. Never a float, never assumed to be /100. */
  readonly minorUnits: number;
  /** ISO-4217 alpha-3, UPPERCASE. */
  readonly currency: string;
}

/**
 * Minor-unit exponents that differ from the default of 2 (ISO-4217 table, currencies in active
 * use). Absent = 2. Used for display and for providers whose APIs take major units (PayPal);
 * the ledger never divides.
 */
const EXPONENT: Readonly<Record<string, 0 | 3>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0,
  UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

const CURRENCY = /^[A-Z]{3}$/;

/** True for an UPPERCASE ISO-4217-shaped alpha-3 code. Shape only: the code list itself is the provider's call. */
export function isCurrencyCode({ currency }: { currency: string }, _optional: Record<string, never> = {}): boolean {
  return CURRENCY.test(currency);
}

/** The currency's minor-unit exponent (0, 2 or 3). */
export function exponentOf({ currency }: { currency: string }, _optional: Record<string, never> = {}): 0 | 2 | 3 {
  return EXPONENT[currency] ?? 2;
}

/**
 * Normalizes untrusted input (`"usd"`, `" Usd "`) to the stored form, or `null` when it is not an
 * alpha-3 code. The single place lowercase legacy input is accepted; everything after it is UPPERCASE.
 */
export function normalizeCurrency({ raw }: { raw: string }, _optional: Record<string, never> = {}): string | null {
  const upper = raw.trim().toUpperCase();
  return CURRENCY.test(upper) ? upper : null;
}

/**
 * Why a value is not valid Money, or `null` when it is. `allowZero` exists for prices (a free
 * item) — a charge or refund amount must be positive.
 */
export function moneyProblem(
  { money }: { money: Money },
  optional: { allowZero?: boolean } = {}
): string | null {
  if (!CURRENCY.test(money.currency)) return `currency must be an uppercase ISO-4217 alpha-3 code, got '${money.currency}'`;
  if (!Number.isSafeInteger(money.minorUnits)) return "minorUnits must be a safe integer number of minor units";
  const min = optional.allowZero === true ? 0 : 1;
  if (money.minorUnits < min) return min === 0 ? "minorUnits must not be negative" : "minorUnits must be greater than zero";
  return null;
}

/** Builds Money from a possibly-lowercase currency, or throws on input that is not Money. */
export function money(
  { minorUnits, currency }: { minorUnits: number; currency: string },
  optional: { allowZero?: boolean } = {}
): Money {
  const value = { minorUnits, currency: normalizeCurrency({ raw: currency }) ?? currency };
  const problem = moneyProblem({ money: value }, optional);
  if (problem) throw new RangeError(problem);
  return value;
}

/** Adds two amounts of the same currency; throws on a currency mismatch or an unsafe result. */
export function addMoney({ a, b }: { a: Money; b: Money }, _optional: Record<string, never> = {}): Money {
  if (a.currency !== b.currency) throw new RangeError(`cannot add ${a.currency} to ${b.currency}`);
  const minorUnits = a.minorUnits + b.minorUnits;
  if (!Number.isSafeInteger(minorUnits)) throw new RangeError("sum exceeds the safe integer range");
  return { minorUnits, currency: a.currency };
}

/** Major-unit decimal string (`1234 USD` → `"12.34"`, `5 JPY` → `"5"`), for display and major-unit provider APIs. */
export function toMajorString({ money: value }: { money: Money }, _optional: Record<string, never> = {}): string {
  const exponent = exponentOf({ currency: value.currency });
  const sign = value.minorUnits < 0 ? "-" : "";
  const digits = String(Math.abs(value.minorUnits));
  if (exponent === 0) return `${sign}${digits}`;
  const padded = digits.padStart(exponent + 1, "0");
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

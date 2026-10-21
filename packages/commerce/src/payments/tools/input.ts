/**
 * @file Strict readers for the payments tools' inputs. The executor validates the published schema,
 * but a handler never trusts that it ran: every field is re-read and bounded here, and an unknown
 * field is refused rather than ignored.
 */
import { requireInputRecord, requireNumber, requireObject, requireString, optionalString, ToolInputError } from "@jini-ai/core";
import { moneyProblem, type Money } from "../../money/money.js";
import { MAX_ID_LENGTH } from "./catalog.js";

/** The input as a record holding only `allowed` keys. @throws {ToolInputError} Otherwise. */
export function strictInput({ input, allowed }: { input: unknown; allowed: readonly string[] }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const record = requireInputRecord({ input });
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new ToolInputError({ message: `unknown field '${extra}'; this tool accepts: ${allowed.join(", ")}` });
  return record;
}

function bounded({ key, value, max }: { key: string; value: string; max: number }): string {
  if (value.trim().length === 0 || value.length > max) throw new ToolInputError({ message: `'${key}' must be 1 to ${max} characters, not blank` });
  return value;
}

/** A required, non-blank string of at most `max` (default {@link MAX_ID_LENGTH}) characters. */
export function requiredText(
  { input, key }: { input: Record<string, unknown>; key: string },
  { max = MAX_ID_LENGTH }: { max?: number } = {}
): string {
  return bounded({ key, value: requireString({ input, key }), max });
}

/** An optional string; when present, non-blank and at most `max` characters. */
export function optionalText(
  { input, key }: { input: Record<string, unknown>; key: string },
  { max = MAX_ID_LENGTH }: { max?: number } = {}
): string | undefined {
  const value = optionalString({ input, key });
  return value === undefined ? undefined : bounded({ key, value, max });
}

/** `amount` as valid, positive Money (whole minor units, uppercase currency). */
export function readAmount({ input }: { input: Record<string, unknown> }, _optional: Record<string, never> = {}): Money {
  const raw = strictInput({ input: requireObject({ input, key: "amount" }), allowed: ["minorUnits", "currency"] });
  const amount = { minorUnits: requireNumber({ input: raw, key: "minorUnits" }), currency: requireString({ input: raw, key: "currency" }) };
  const problem = moneyProblem({ money: amount });
  if (problem) throw new ToolInputError({ message: `amount: ${problem}` });
  return amount;
}

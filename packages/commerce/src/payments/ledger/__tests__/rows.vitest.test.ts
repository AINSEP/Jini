import { describe, expect, test } from "vitest";

import {
  decodeMinor, decodeNullableMinor, encodeColumns, encodeMinor, encodeNullableMinor, inboxFromRow, PAYMENT_PATCH_COLUMNS, patchColumns,
  paymentFromRow,
} from "../rows.js";

describe("decodeMinor: the one integer decoder every row mapper uses", () => {
  test("numbers, decimal strings (node-pg BIGINT) and bigints (safeIntegers, PGlite) decode to the same number", () => {
    expect(decodeMinor(1999)).toBe(1999);
    expect(decodeMinor("1999")).toBe(1999);
    expect(decodeMinor(1999n)).toBe(1999);
    expect(decodeMinor("-42")).toBe(-42);
    expect(decodeMinor(0)).toBe(0);
    expect(decodeMinor(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("never rounds: beyond MAX_SAFE_INTEGER throws, from every representation", () => {
    expect(() => decodeMinor(2 ** 53)).toThrow(TypeError);
    expect(() => decodeMinor("9007199254740993")).toThrow(/safe integer.*9007199254740993/);
    expect(() => decodeMinor(9007199254740993n)).toThrow(TypeError);
  });

  test("fractions, non-numeric text and other types throw", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, "1.5", "", " 1", "1e3", "+1", "0x10", null, undefined, true, {}]) {
      expect(() => decodeMinor(bad), String(bad)).toThrow(TypeError);
    }
  });

  test("-0 decodes to 0 from every representation", () => {
    for (const zero of [-0, "-0", 0n]) expect(Object.is(decodeMinor(zero), 0), String(zero)).toBe(true);
  });

  test("the NULLable variant keeps SQL NULL and decodes anything else", () => {
    expect(decodeNullableMinor(null)).toBeNull();
    expect(decodeNullableMinor("7")).toBe(7);
    expect(() => decodeNullableMinor(undefined)).toThrow(TypeError);
  });
});

describe("encodeMinor: the one integer encoder every write uses", () => {
  test("a safe integer passes unchanged; -0 becomes 0", () => {
    expect(encodeMinor(1999)).toBe(1999);
    expect(encodeMinor(-42)).toBe(-42);
    expect(encodeMinor(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.is(encodeMinor(-0), 0)).toBe(true);
  });

  test("anything a driver would round, truncate or store as REAL throws TypeError", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "1", 1n, null, undefined]) {
      expect(() => encodeMinor(bad as number), String(bad)).toThrow(/expected a safe integer to write/);
    }
  });

  test("the NULLable variant keeps null; encodeColumns encodes only integer columns", () => {
    expect(encodeNullableMinor(null)).toBeNull();
    expect(encodeNullableMinor(-0)).toBe(0);
    expect(encodeColumns({ status: "x", amount_minor: -0, fee_minor: null, reference: "1.5" })).toEqual({ status: "x", amount_minor: 0, fee_minor: null, reference: "1.5" });
    expect(() => encodeColumns({ updated_at: 1.5 })).toThrow(TypeError);
  });
});

describe("entry points", () => {
  test("payments/kernel carries the port, records and memory adapter; the SQL half (kysely, @jini-ai/db at runtime) is ledger/sql", async () => {
    const kernel: Record<string, unknown> = await import("../../kernel.js");
    expect(typeof kernel.memoryPaymentsLedger).toBe("function");
    expect(typeof kernel.decodeMinor).toBe("function");
    expect(typeof kernel.LedgerConstraintError).toBe("function");
    expect(kernel.sqlPaymentsLedger).toBeUndefined();
    expect(kernel.migrateCommercePayments).toBeUndefined();
    const sqlEntry: Record<string, unknown> = await import("../sql.js");
    expect(Object.keys(sqlEntry).sort()).toEqual([
      "COMMERCE_PAYMENTS_LEDGER_TABLE", "COMMERCE_PAYMENTS_MIGRATIONS", "PAYMENTS_LEDGER_ID", "constraintKindOf",
      "migrateCommercePayments", "paymentsLedger", "pinnedChecksum", "sqlPaymentsLedger",
    ]);
  });
});

describe("row mappers", () => {
  test("a Postgres row (BIGINTs as strings) maps to the same record as a SQLite row", () => {
    const row = {
      id: "pay-1", workspace_id: "ws", site_id: "s", provider_id: "stripe", provider_account_id: "acct", mode: "live",
      idempotency_key: "k", reference: "r", party_id: null, currency: "USD", amount_minor: "10000", captured_minor: "10000",
      intent_status: "succeeded", refunded_minor: "0", refund_held_minor: "3000", disputed_minor: "0", status: "succeeded",
      provider_ref: "pi_1", next_action_json: null, fee_currency: "USD", fee_minor: "320", net_currency: null, net_minor: null,
      settlement_currency: null, settlement_minor: null, version: 3, created_at: "1700000000000", updated_at: "1700000000001",
    };
    const record = paymentFromRow(row);
    expect(record).toMatchObject({ amountMinor: 10_000, refundHeldMinor: 3_000, feeMinor: 320, netMinor: null, version: 3, createdAt: 1_700_000_000_000 });
    expect(paymentFromRow({ ...row, amount_minor: 10_000, fee_minor: 320, created_at: 1_700_000_000_000, updated_at: 1_700_000_000_001 })).toEqual(record);
  });

  test("a corrupt amount fails the read instead of producing a wrong number", () => {
    const row = {
      id: "in-1", workspace_id: "ws", site_id: "s", provider_id: "p", provider_account_id: "a", mode: "test", provider_event_id: "e",
      facts_json: null, body_sha256: "h", state: "parked", attempts: "1.5", next_attempt_at: 1, last_error: null, received_at: 1,
      applied_at: null, purged_at: null,
    };
    expect(() => inboxFromRow(row)).toThrow(TypeError);
  });

  test("patchColumns maps present fields to columns, encodes integers and skips undefined ones", () => {
    const patch = { status: "refunded", feeMinor: null, partyId: undefined, refundedMinor: -0, updatedAt: 5 } as const;
    const set = patchColumns({ patch, columns: PAYMENT_PATCH_COLUMNS });
    expect(set).toEqual({ status: "refunded", fee_minor: null, refunded_minor: 0, updated_at: 5 });
    expect(Object.is(set.refunded_minor, 0)).toBe(true);
    expect(() => patchColumns({ patch: { capturedMinor: 1.5, updatedAt: 5 }, columns: PAYMENT_PATCH_COLUMNS })).toThrow(TypeError);
  });

  test("patchColumns is an allow-list: an unknown key throws, even an inherited name or an undefined value", () => {
    for (const key of ["workspaceId", "version", "toString", "id"]) {
      const patch = { [key]: undefined, updatedAt: 5 } as unknown as { updatedAt: number };
      expect(() => patchColumns({ patch, columns: PAYMENT_PATCH_COLUMNS }), key).toThrow(`ledger: ${key} is not a patchable field`);
    }
  });
});

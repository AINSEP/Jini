import { describe, expect, test } from "vitest";

import {
  decodeMinor, decodeNullableMinor, encodeColumns, encodeMinor, encodeNullableMinor, inboxFromRow, PAYMENT_PATCH_COLUMNS, patchColumns,
  paymentFromRow,
  attemptFromRow, attemptToRow, disputeFromRow, disputeToRow, evidenceFromRow, evidenceToRow,
  operatorActionFromRow, operatorActionToRow, outboxFromRow, outboxToRow, quarantineFromRow, quarantineToRow,
  refundFromRow, refundToRow, revivedPayload,
} from "../rows.js";

describe("decodeMinor: the one integer decoder every row mapper uses", () => {
  test("numbers, decimal strings (node-pg BIGINT) and bigints (safeIntegers, PGlite) decode to the same number", () => {
    expect(decodeMinor({ value: 1999 })).toBe(1999);
    expect(decodeMinor({ value: "1999" })).toBe(1999);
    expect(decodeMinor({ value: 1999n })).toBe(1999);
    expect(decodeMinor({ value: "-42" })).toBe(-42);
    expect(decodeMinor({ value: 0 })).toBe(0);
    expect(decodeMinor({ value: String(Number.MAX_SAFE_INTEGER) })).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("never rounds: beyond MAX_SAFE_INTEGER throws, from every representation", () => {
    expect(() => decodeMinor({ value: 2 ** 53 })).toThrow(TypeError);
    expect(() => decodeMinor({ value: "9007199254740993" })).toThrow(/safe integer.*9007199254740993/);
    expect(() => decodeMinor({ value: 9007199254740993n })).toThrow(TypeError);
  });

  test("fractions, non-numeric text and other types throw", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, "1.5", "", " 1", "1e3", "+1", "0x10", null, undefined, true, {}]) {
      expect(() => decodeMinor({ value: bad }), String(bad)).toThrow(TypeError);
    }
  });

  test("-0 decodes to 0 from every representation", () => {
    for (const zero of [-0, "-0", 0n]) expect(Object.is(decodeMinor({ value: zero }), 0), String(zero)).toBe(true);
  });

  test("the NULLable variant keeps SQL NULL and decodes anything else", () => {
    expect(decodeNullableMinor({ value: null })).toBeNull();
    expect(decodeNullableMinor({ value: "7" })).toBe(7);
    expect(() => decodeNullableMinor({ value: undefined })).toThrow(TypeError);
  });
});

describe("integer boundaries refuse coercion and rounding", () => {
  test.each([
    [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
    [String(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER],
    [BigInt(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER],
    ["0007", 7], ["-0007", -7], ["0", 0], ["9", 9],
  ])("decodes %s to the exact safe integer %s", (value, expected) => {
    expect(decodeMinor({ value }, {})).toBe(expected);
  });

  test.each([[], {}, false, -Infinity, -1.5, -(2 ** 53), "-9007199254740993", -9007199254740993n, "1e2", "+7", "7 ", " 7", "7!", "a7", "7a", "--7", "7.0", "７", "\n7"].map((value) => ({ value })))
    ("rejects a non-integer database representation $value", ({ value }) => {
      expect(() => decodeMinor({ value })).toThrow(TypeError);
      expect(() => decodeMinor({ value })).toThrow("ledger: expected a safe integer from the database");
    });

  // Regression: `$` accepts a position before a final newline; database integer strings must not contain whitespace.
  test.each(["7\n", "-7\n"])("rejects the trailing newline in database integer %j", (value) => {
    expect(() => decodeMinor({ value })).toThrow(TypeError);
    expect(() => decodeMinor({ value })).toThrow("ledger: expected a safe integer from the database");
  });

  test("encoding copies its input and preserves exact signed monetary adjustments", () => {
    const input = Object.freeze({ fee_minor: -17, net_minor: Number.MIN_SAFE_INTEGER, settlement_minor: null, currency: "USD" });
    const encoded = encodeColumns(input, {});
    expect(encoded).toEqual({ fee_minor: -17, net_minor: -9_007_199_254_740_991, settlement_minor: null, currency: "USD" });
    expect(encoded).not.toBe(input);
    expect(encodeMinor({ value: Number.MIN_SAFE_INTEGER }, {})).toBe(-9_007_199_254_740_991);
    expect(encodeNullableMinor({ value: null }, {})).toBeNull();
    expect(decodeNullableMinor({ value: null }, {})).toBeNull();
  });

  test("a revived payload replaces only verified facts, hash and purge time", () => {
    expect(revivedPayload({}, {})).toEqual({});
    const payload = Object.freeze({ factsJson: '{"verified":true}', bodySha256: "cd".repeat(32) });
    expect(revivedPayload({ payload }, {})).toEqual({ facts_json: '{"verified":true}', body_sha256: "cd".repeat(32), purged_at: null });
    expect(payload).toEqual({ factsJson: '{"verified":true}', bodySha256: "cd".repeat(32) });
  });
});

describe("record codecs preserve independent monetary and time fields", () => {
  const scope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct", mode: "live" as const };
  const rowScope = { workspace_id: "ws", site_id: "site", provider_id: "stripe", provider_account_id: "acct", mode: "live" };

  test("capture amounts and both timestamps survive driver integer representations", () => {
    const record = {
      ...scope, id: "att", paymentId: "pay", op: "capture" as const, operationKey: "operation", refundId: "refund",
      outcome: "unknown" as const, errorCode: "TIMEOUT", errorMessage: "reply lost", createdAt: 101, updatedAt: 203,
      currency: "JPY", amountMinor: 307,
    };
    const row = {
      ...rowScope, id: "att", payment_id: "pay", op: "capture", operation_key: "operation", refund_id: "refund",
      outcome: "unknown", error_code: "TIMEOUT", error_message: "reply lost", created_at: 101, updated_at: 203,
      currency: "JPY", amount_minor: 307,
    };
    expect(attemptToRow(record, {})).toEqual(row);
    expect(attemptFromRow({ ...row, created_at: "101", updated_at: 203n, amount_minor: "307" }, {})).toEqual(record);
  });

  test("a refund preserves its currency, exact amount, reason and scoped references", () => {
    const record = {
      ...scope, id: "refund", paymentId: "pay", idempotencyKey: "key", providerRefundRef: "re_1", currency: "USD",
      amountMinor: 101, status: "succeeded" as const, reason: "requested", createdAt: 203, updatedAt: 307,
    };
    const row = {
      ...rowScope, id: "refund", payment_id: "pay", idempotency_key: "key", provider_refund_ref: "re_1", currency: "USD",
      amount_minor: 101, status: "succeeded", reason: "requested", created_at: 203, updated_at: 307,
    };
    expect(refundToRow(record, {})).toEqual(row);
    expect(refundFromRow({ ...row, amount_minor: 101n, created_at: "203", updated_at: "307" }, {})).toEqual(record);
  });

  test("a dispute keeps amount, deadline, creation and update times distinct", () => {
    const record = {
      ...scope, id: "dispute", paymentId: "pay", providerDisputeRef: "dp_1", currency: "EUR", amountMinor: 101,
      status: "lost" as const, dueBy: 203, createdAt: 307, updatedAt: 409,
    };
    const row = {
      ...rowScope, id: "dispute", payment_id: "pay", provider_dispute_ref: "dp_1", currency: "EUR", amount_minor: 101,
      status: "lost", due_by: 203, created_at: 307, updated_at: 409,
    };
    expect(disputeToRow(record, {})).toEqual(row);
    expect(disputeFromRow({ ...row, amount_minor: "101", due_by: 203n, created_at: "307", updated_at: "409" }, {})).toEqual(record);
  });

  test("operator evidence retains its source, subject, observation and exact signed amount", () => {
    const record = {
      ...scope, id: "ev", paymentId: "pay", source: "operator" as const, subject: "payment" as const, subjectRef: "pi_1",
      observedStatus: "succeeded", currency: "GBP", amountMinor: -17, inboxId: "in", recordedAt: 203,
    };
    const row = {
      ...rowScope, id: "ev", payment_id: "pay", source: "operator", subject: "payment", subject_ref: "pi_1",
      observed_status: "succeeded", currency: "GBP", amount_minor: -17, inbox_id: "in", recorded_at: 203,
    };
    expect(evidenceToRow(record, {})).toEqual(row);
    expect(evidenceFromRow({ ...row, amount_minor: "-17", recorded_at: 203n }, {})).toEqual(record);
  });

  test("a published outbox row preserves its payload and publication timestamp", () => {
    const record = { id: "out", workspaceId: "ws", mode: "test" as const, topic: "dispute.closed" as const, aggregateId: "dis", payloadJson: '{"closed":true}', createdAt: 101, publishedAt: 203 };
    const row = { id: "out", workspace_id: "ws", mode: "test", topic: "dispute.closed", aggregate_id: "dis", payload_json: '{"closed":true}', created_at: 101, published_at: 203 };
    expect(outboxToRow(record, {})).toEqual(row);
    expect(outboxFromRow({ ...row, created_at: "101", published_at: 203n }, {})).toEqual(record);
  });

  test("a resolved quarantine preserves its open-ended subject and reason", () => {
    const record = { id: "q", workspaceId: "ws", mode: "test" as const, paymentId: "pay", subject: "future-subject", reason: "future-reason", evidenceJson: '{"evidence":1}', createdAt: 101, resolvedAt: 203 };
    const row = { id: "q", workspace_id: "ws", mode: "test", payment_id: "pay", subject: "future-subject", reason: "future-reason", evidence_json: '{"evidence":1}', created_at: 101, resolved_at: 203 };
    expect(quarantineToRow(record, {})).toEqual(row);
    expect(quarantineFromRow({ ...row, created_at: 101n, resolved_at: "203" }, {})).toEqual(record);
  });

  test("operator audit preserves actor, outcome and refund correlation", () => {
    const record = {
      ...scope, id: "action", paymentId: "pay", refundId: "refund", action: "resolve-unknown" as const,
      outcome: "succeeded", actor: "operator-1", reason: "provider confirmed", createdAt: 101,
    };
    const row = {
      ...rowScope, id: "action", payment_id: "pay", refund_id: "refund", action: "resolve-unknown",
      outcome: "succeeded", actor: "operator-1", reason: "provider confirmed", created_at: 101,
    };
    expect(operatorActionToRow(record, {})).toEqual(row);
    expect(operatorActionFromRow({ ...row, created_at: "101" }, {})).toEqual(record);
  });
});

describe("encodeMinor: the one integer encoder every write uses", () => {
  test("a safe integer passes unchanged; -0 becomes 0", () => {
    expect(encodeMinor({ value: 1999 })).toBe(1999);
    expect(encodeMinor({ value: -42 })).toBe(-42);
    expect(encodeMinor({ value: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.is(encodeMinor({ value: -0 }), 0)).toBe(true);
  });

  test("anything a driver would round, truncate or store as REAL throws TypeError", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "1", 1n, null, undefined]) {
      expect(() => encodeMinor({ value: bad as number }), String(bad)).toThrow(/expected a safe integer to write/);
    }
  });

  test("the NULLable variant keeps null; encodeColumns encodes only integer columns", () => {
    expect(encodeNullableMinor({ value: null })).toBeNull();
    expect(encodeNullableMinor({ value: -0 })).toBe(0);
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
      "COMMERCE_PAYMENTS_LEDGER_TABLE", "COMMERCE_PAYMENTS_MIGRATIONS", "PAYMENTS_LEDGER_ID", "PAYMENTS_OPERATOR_ACTIONS_ID",
      "constraintKindOf", "migrateCommercePayments", "paymentsLedger", "paymentsOperatorActions", "pinnedChecksum",
      "sqlPaymentsLedger",
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

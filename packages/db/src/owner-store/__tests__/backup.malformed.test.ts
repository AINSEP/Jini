import { sealWithPassphrase } from "@jini-ai/platform/secrets";
import { afterAll, beforeAll, expect, test } from "vitest";
import { OwnerStoreBackupError, restoreOwnerStore } from "../backup.js";
import type { OwnerStoreService } from "../service.js";
import { fixture, input } from "./fixture.js";

/** L2 §4/§5: every INVALID_BACKUP shape check gets its own authenticated-but-malformed snapshot
 *  (one clause broken per case) and must be refused with that exact code BEFORE any write. */
const item = fixture();
let store: OwnerStoreService;
beforeAll(async () => { store = await item.open(); });
afterAll(async () => { await item.cleanup(); });

const token = input.payload.token;
const entry = { id: "e1", kind: "vendor", ownerKey: "plugin", binding: null, provider: "provider", label: "Key",
  isDefault: false, meta: input.meta, payload: { token } };
const doc = (entries: unknown[], extra: Record<string, unknown> = {}) => ({ format: "jini-owner-store", version: 1, entries, ...extra });
const restoreText = async (payload: string) => restoreOwnerStore({ store, envelope: await sealWithPassphrase({ payload, passphrase: "p" }), passphrase: "p" });
const omit = (key: string) => Object.fromEntries(Object.entries(entry).filter(([name]) => name !== key));

test.each<[string, string]>([
  ["non-JSON payload", "{not json"],
  ["JSON null", "null"],
  ["JSON array", JSON.stringify([doc([entry])])],
  ["wrong format", JSON.stringify({ ...doc([entry]), format: "other" })],
  ["version 2", JSON.stringify({ ...doc([entry]), version: 2 })],
  ["version '1' string", JSON.stringify({ ...doc([entry]), version: "1" })],
  ["entries not an array", JSON.stringify({ ...doc([]), entries: { 0: entry } })],
  ["entry is null", JSON.stringify(doc([null]))],
  ["entry is an array", JSON.stringify(doc([[entry]]))],
  ["duplicate ids", JSON.stringify(doc([entry, { ...entry, label: "Other" }]))],
  ...["id", "kind", "ownerKey", "binding", "provider", "label", "isDefault", "meta", "payload"].map(key => [`missing ${key}`, JSON.stringify(doc([omit(key)]))] as [string, string]),
  ["unknown extra field", JSON.stringify(doc([{ ...entry, sealed: "x" }]))],
  ["empty id", JSON.stringify(doc([{ ...entry, id: "" }]))],
  ["numeric id", JSON.stringify(doc([{ ...entry, id: 1 }]))],
  ["empty ownerKey", JSON.stringify(doc([{ ...entry, ownerKey: "" }]))],
  ["empty label", JSON.stringify(doc([{ ...entry, label: "" }]))],
  ["numeric binding", JSON.stringify(doc([{ ...entry, binding: 3 }]))],
  ["object provider", JSON.stringify(doc([{ ...entry, provider: {} }]))],
  ["unknown kind", JSON.stringify(doc([{ ...entry, kind: "root" }]))],
  ["non-copyable kind", JSON.stringify(doc([{ ...entry, kind: "personal-execution" }]))],
  ["meta is an array", JSON.stringify(doc([{ ...entry, meta: [] }]))],
  ["meta is null", JSON.stringify(doc([{ ...entry, meta: null }]))],
  ["payload is a string", JSON.stringify(doc([{ ...entry, payload: "s" }]))],
  ["payload is an array", JSON.stringify(doc([{ ...entry, payload: [] }]))],
  ["isDefault as string", JSON.stringify(doc([{ ...entry, isDefault: "false" }]))],
  ["last4 of length 3", JSON.stringify(doc([{ ...entry, last4: "val", tokenLength: token.length }]))],
  ["last4 of length 5", JSON.stringify(doc([{ ...entry, last4: "value", tokenLength: token.length }]))],
  ["last4 numeric", JSON.stringify(doc([{ ...entry, last4: 1234, tokenLength: token.length }]))],
  ["negative tokenLength", JSON.stringify(doc([{ ...entry, tokenLength: -1 }]))],
  ["fractional tokenLength", JSON.stringify(doc([{ ...entry, tokenLength: 1.5 }]))],
  ["string tokenLength", JSON.stringify(doc([{ ...entry, tokenLength: "12" }]))],
  ["last4 without tokenLength", JSON.stringify(doc([{ ...entry, last4: "alue" }]))],
  ["last4 with tokenLength 11 (short token)", JSON.stringify(doc([{ ...entry, last4: "alue", tokenLength: 11 }]))],
  ["hint on a null payload", JSON.stringify(doc([{ ...entry, payload: null, tokenLength: 0 }]))],
  ["hint on a database-destination", JSON.stringify(doc([{ ...entry, kind: "database-destination", last4: "alue", tokenLength: 40 }]))],
])("%s → OwnerStoreBackupError{invalid-backup}, nothing written", async (_label, payload) => {
  const error = await restoreText(payload).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(OwnerStoreBackupError);
  expect(error).toMatchObject({ code: "invalid-backup", message: "Owner store backup: invalid-backup", name: "OwnerStoreBackupError" });
  expect(await store.list({})).toEqual([]);
});

test("boundary hints are accepted: last4 with tokenLength exactly 12, tokenLength 0 with no last4", async () => {
  const other = fixture();
  try {
    const target = await other.open();
    const payload = JSON.stringify(doc([{ ...entry, last4: "alue", tokenLength: 12 }, { ...entry, id: "e2", label: "Second", tokenLength: 0 }]));
    const envelope = await sealWithPassphrase({ payload, passphrase: "p" });
    await expect(restoreOwnerStore({ store: target, envelope, passphrase: "p" })).resolves.toEqual({ restored: 2 });
    const hints = (await target.list({})).map(summary => [summary.id, summary.last4, summary.tokenLength]).sort();
    expect(hints).toEqual([["e1", "alue", 12], ["e2", null, 0]]);
  } finally {
    await other.cleanup();
  }
});

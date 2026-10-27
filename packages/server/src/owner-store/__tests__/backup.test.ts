import { sealWithPassphrase } from "@jini-ai/platform/secrets";
import { expect, test } from "vitest";
import { readLegacyOwnerBackup } from "../backup.js";
import { input } from "./fixture.js";

type Doc = Record<string, any>;
const first = { id: "entry-1", kind: input.kind, ownerKey: input.ownerKey, binding: null, provider: input.provider, label: input.label,
  isDefault: true, meta: input.meta, payload: input.payload, last4: "cape", tokenLength: input.payload.token.length };
const second = { ...first, id: "entry-2", label: "Second", isDefault: false, last4: null, tokenLength: null };
const entryView = ({ last4: _last4, tokenLength: _length, ...entry }: typeof first | typeof second) => entry;
/** The document @jini-ai/db 0.6.12 actually exported: entries only, no hints, grants or cleanup records. */
const publishedV1 = (): Doc => ({ format: "jini-owner-store", version: 1, entries: [first, second].map(entryView) });
const v2 = (): Doc => ({ format: "jini-owner-store", version: 2, entries: [first, second],
  grants: [{ entryId: "entry-1", consumerId: "/sites/one", workspaceId: "ws-one", createdAt: "2026-10-01T00:00:00.000Z" },
    { entryId: "entry-2", consumerId: "/sites/two", workspaceId: null, createdAt: "2026-10-01T00:00:00.000Z" }],
  revocations: [{ entryId: "entry-1", consumerId: "/sites/old", workspaceId: "ws-old", attempts: 1, updatedAt: "2026-10-02T00:00:00.000Z" }],
  unreconciled: ["entry-2"] });
const seal = (doc: Doc, passphrase = "recovery") => sealWithPassphrase({ payload: JSON.stringify(doc), passphrase });
const rejected = async (doc: Doc) => expect(readLegacyOwnerBackup({ envelope: await seal(doc), passphrase: "recovery" }))
  .rejects.toMatchObject({ code: "invalid-backup" });

test("a published version-1 backup reads its entries with no recorded destinations", async () => {
  expect(await readLegacyOwnerBackup({ envelope: await seal(publishedV1()), passphrase: "recovery" }))
    .toEqual({ entries: [entryView(first), entryView(second)], grants: [], revocations: [] });
});

test("a version-2 backup returns grants and pending cleanups as destinations, without hints", async () => {
  expect(await readLegacyOwnerBackup({ envelope: await seal(v2()), passphrase: "recovery" })).toEqual({
    entries: [entryView(first), entryView(second)],
    grants: [{ entryId: "entry-1", consumerId: "/sites/one" }, { entryId: "entry-2", consumerId: "/sites/two" }],
    revocations: [{ entryId: "entry-1", consumerId: "/sites/old" }],
  });
});

test("a wrong passphrase fails authentication", async () => {
  await expect(readLegacyOwnerBackup({ envelope: await seal(v2(), "right"), passphrase: "wrong" })).rejects.toThrow(/authentication/);
});

test.each([
  ["missing list", (s: Doc) => { s.grants = undefined; }],
  ["unknown entry", (s: Doc) => { s.grants[1].entryId = "absent"; }],
  ["duplicate pair", (s: Doc) => { s.grants.push({ ...s.grants[0] }); }],
  ["missing time", (s: Doc) => { delete s.grants[1].createdAt; }],
  ["empty consumer", (s: Doc) => { s.grants[1].consumerId = ""; }],
  ["extra field", (s: Doc) => { s.grants[1].sealed = {}; }],
  ["missing destination", (s: Doc) => { delete s.grants[1].workspaceId; }],
  ["empty destination", (s: Doc) => { s.grants[1].workspaceId = ""; }],
])("rejects a grant with a %s", async (_name, patch) => {
  const doc = v2(); patch(doc); await rejected(doc);
});

test.each([
  ["missing list", (s: Doc) => { delete s.unreconciled; }],
  ["unknown entry", (s: Doc) => { s.unreconciled = ["absent"]; }],
  ["duplicate entry", (s: Doc) => { s.unreconciled.push(s.unreconciled[0]); }],
])("rejects an unreconciled list with a %s", async (_name, patch) => {
  const doc = v2(); patch(doc); await rejected(doc);
});

test.each([
  ["missing list", (s: Doc) => { s.revocations = undefined; }],
  ["unknown entry", (s: Doc) => { s.revocations[0].entryId = "absent"; }],
  ["duplicate pair", (s: Doc) => { s.revocations.push({ ...s.revocations[0] }); }],
  ["missing workspace", (s: Doc) => { delete s.revocations[0].workspaceId; }],
  ["empty consumer", (s: Doc) => { s.revocations[0].consumerId = ""; }],
  ["zero attempts", (s: Doc) => { s.revocations[0].attempts = 0; }],
  ["extra field", (s: Doc) => { s.revocations[0].sealed = {}; }],
])("rejects a pending cleanup with a %s", async (_name, patch) => {
  const doc = v2(); patch(doc); await rejected(doc);
});

test.each([
  ["suffix type", { last4: 1234, tokenLength: 12 }],
  ["suffix length", { last4: "too-long", tokenLength: 12 }],
  ["length type", { last4: null, tokenLength: "12" }],
  ["negative length", { last4: null, tokenLength: -1 }],
  ["fractional length", { last4: null, tokenLength: 12.5 }],
  ["short-token suffix", { last4: "tail", tokenLength: 11 }],
  ["missing length", { last4: "tail", tokenLength: null }],
  ["unconfigured hint", { last4: "tail", tokenLength: 12, payload: null }],
  ["database hint", { last4: "tail", tokenLength: 12, kind: "database-destination", meta: {} }],
  ["non-copyable kind", { kind: "custom" }],
])("rejects an entry with an invalid %s", async (_name, patch) => {
  const doc = v2(); doc.entries.push({ ...first, id: "entry-3", label: "Other", ...patch }); await rejected(doc);
});

test.each(["duplicate", "version", "extra-field", "format"])("rejects an authenticated but invalid %s snapshot", async mode => {
  const doc = v2();
  if (mode === "duplicate") doc.entries.push(doc.entries[0]);
  if (mode === "version") doc.version = 3;
  if (mode === "extra-field") doc.entries[0] = { ...doc.entries[0], sealed: {} };
  if (mode === "format") doc.format = "other";
  await rejected(doc);
});

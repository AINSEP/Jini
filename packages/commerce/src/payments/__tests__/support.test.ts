import assert from "node:assert/strict";
import test from "node:test";
import { FakeHttpClient } from "./support.js";

test("FakeHttpClient consumes each scripted response once and rejects an extra request", async () => {
  const http = new FakeHttpClient([{ status: 201, headers: {}, bodyText: "first" }, { status: 202, headers: {}, bodyText: "second" }]);
  const request = { method: "POST" as const, url: "https://lipay.test/v1/charges", headers: {}, timeoutMs: 5_000 };
  assert.equal((await http.send({ request })).bodyText, "first");
  assert.equal((await http.send({ request })).bodyText, "second");
  await assert.rejects(() => http.send({ request }), /^Error: unexpected provider request: POST https:\/\/lipay\.test\/v1\/charges \(script exhausted\)$/);
  assert.equal(http.calls.length, 3);
});

test("FakeHttpClient rejects the first request when no responses were scripted", async () => {
  await assert.rejects(() => new FakeHttpClient([]).send({ request: { method: "GET", url: "https://lipay.test/", headers: {}, timeoutMs: 5_000 } }), /script exhausted/);
});

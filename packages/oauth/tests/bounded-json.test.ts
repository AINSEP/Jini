import assert from "node:assert/strict";
import { test } from "vitest";

import { parseOAuthJsonObject, readBoundedOAuthJson, readBoundedOAuthText, readOptionalString, readStringArray } from "../src/bounded-json.js";
import { OAuthError } from "../src/errors.js";

const messages = {
  overflowMessage: "fixture body exceeds its limit", overflowOperatorAction: "Reduce the fixture body.",
  notJsonMessage: "fixture requires a JSON object", notJsonOperatorAction: "Return an object.",
};

// F4.3/F6.2: replacing byteLength with string length or >= rejects/accepts the wrong boundary.
test("the text reader counts UTF-8 bytes across chunks and accepts exactly the cap", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(Uint8Array.from([0xc3]));
    controller.enqueue(Uint8Array.from([0xa9, 0x21]));
    controller.close();
  } });
  assert.equal(await readBoundedOAuthText(new Response(body), messages, 3), "é!");
  assert.equal(await readBoundedOAuthText(new Response(null), messages, 0), "");
});

test("overflow cancels an unfinished stream immediately and retains the caller's error and action", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(Uint8Array.from([0xc3, 0xa9])); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readBoundedOAuthText(new Response(body), messages, 3), {
    name: "OAuthError", code: "OAUTH_MALFORMED_RESPONSE", message: "fixture body exceeds its limit",
    operatorAction: "Reduce the fixture body.", retryable: false,
  });
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
});

test("a read failure stays a read failure even if cancelling the stream also fails", async () => {
  const failure = new Error("fixture connection reset");
  const body = new ReadableStream<Uint8Array>({ pull() { throw failure; } });
  await assert.rejects(readBoundedOAuthText(new Response(body), messages), (error) => error === failure);
});

for (const text of ["null", "[]", "[{}]", '"token"', "123", "true", "<html>", ""]) {
  test(`JSON reader rejects non-object ${JSON.stringify(text)} with the subject's error`, () => {
    assert.throws(() => parseOAuthJsonObject(text, messages), (error) => {
      assert.ok(error instanceof OAuthError);
      assert.equal(error.code, "OAUTH_MALFORMED_RESPONSE");
      assert.equal(error.message, "fixture requires a JSON object");
      assert.equal(error.operatorAction, "Return an object.");
      return true;
    });
  });
}

test("bounded JSON returns the whole object's exact values and uses the supplied cap", async () => {
  assert.deepEqual(await readBoundedOAuthJson(new Response('{"scope":"read","nested":{"n":7}}'), messages, 40), {
    scope: "read", nested: { n: 7 },
  });
  await assert.rejects(readBoundedOAuthJson(new Response('{"scope":"read"}'), messages, 4), {
    code: "OAUTH_MALFORMED_RESPONSE", message: "fixture body exceeds its limit",
  });
});

test("string readers filter invalid members without coercion and trim optional strings", () => {
  assert.deepEqual(readStringArray(["read", "", 7, null, "write", false]), ["read", "write"]);
  for (const input of [undefined, null, "read", { scope: "write" }]) assert.deepEqual(readStringArray(input), []);
  assert.equal(readOptionalString(" \t credential \n"), "credential");
  for (const input of [undefined, null, 7, false, {}, "", " \t "]) assert.equal(readOptionalString(input), null);
});

// Generalized from the copied parsed-JSON body limit tests.
import assert from "node:assert/strict";
import { test } from "vitest";

import { rejectOversizedJsonBody as createLimit } from "../middleware.js";

const LIMIT = 1024 * 1024;
const errorResponseFactory = () => ({ error: "Too large.", code: "PAYLOAD_TOO_LARGE" });
function rejectOversizedJsonBody(required: { maxBytes: number }) {
  return createLimit({ ...required, errorResponseFactory });
}


function fakeReqRes(body: unknown) {
  const req = { body } as Parameters<ReturnType<typeof rejectOversizedJsonBody>>[0];
  let statusCode: number | undefined;
  let jsonPayload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      jsonPayload = payload;
      return this;
    },
  } as unknown as Parameters<ReturnType<typeof rejectOversizedJsonBody>>[1];
  return { req, res, getStatus: () => statusCode, getJson: () => jsonPayload };
}

test("rejectOversizedJsonBody calls next() and does not respond when the body is under the cap", () => {
  const middleware = rejectOversizedJsonBody({ maxBytes: LIMIT });
  const { req, res, getStatus } = fakeReqRes({ title: "Small post" });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(getStatus(), undefined);
});

test("rejectOversizedJsonBody responds 413 PAYLOAD_TOO_LARGE and does not call next() when the body exceeds the cap", () => {
  const middleware = rejectOversizedJsonBody({ maxBytes: 100 });
  const { req, res, getStatus, getJson } = fakeReqRes({ padding: "a".repeat(200) });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 413);
  assert.deepEqual(getJson(), { error: "Too large.", code: "PAYLOAD_TOO_LARGE" });
});

test("rejectOversizedJsonBody accepts an undefined body under a normal cap", () => {
  const middleware = rejectOversizedJsonBody({ maxBytes: LIMIT });
  const { req, res, getStatus } = fakeReqRes(undefined);

  let nextCalled = false;
  assert.doesNotThrow(() =>
    middleware(req, res, () => {
      nextCalled = true;
    })
  );
  assert.equal(nextCalled, true);
  assert.equal(getStatus(), undefined);
});

test("rejectOversizedJsonBody accepts a body exactly at the byte boundary", () => {
  // `{"a":"..."}` where the padding is sized so the whole serialized object is exactly maxBytes.
  const maxBytes = 20;
  const middleware = rejectOversizedJsonBody({ maxBytes });
  const exact = JSON.stringify({ a: "" });
  const paddingLength = maxBytes - Buffer.byteLength(exact, "utf8");
  const { req, res, getStatus } = fakeReqRes({ a: "x".repeat(paddingLength) });

  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(getStatus(), undefined);
});

test('rejectOversizedJsonBody measures UTF-8 bytes and passes exact sizes to the required response factory', () => {
  const calls: unknown[] = [];
  const middleware = createLimit({ maxBytes: 4, errorResponseFactory: (input) => {
    calls.push(input);
    return { message: 'Caller-selected wording', ceiling: input.maxBytes, observed: input.bodyBytes };
  } });
  const { req, res, getStatus, getJson } = fakeReqRes('éé');
  let nextCalls = 0;
  middleware(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(getStatus(), 413);
  assert.deepEqual(calls, [{ maxBytes: 4, bodyBytes: 6 }]);
  assert.deepEqual(getJson(), { message: 'Caller-selected wording', ceiling: 4, observed: 6 });
});

test('rejectOversizedJsonBody preserves the two-byte empty-object fallback for null and undefined', () => {
  for (const body of [null, undefined]) {
    const { req, res, getStatus } = fakeReqRes(body);
    let nextCalls = 0;
    createLimit({ maxBytes: 1, errorResponseFactory })(req, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0);
    assert.equal(getStatus(), 413);
  }
});

test('rejectOversizedJsonBody accepts an exact UTF-8 boundary without building an error response', () => {
  const { req, res, getStatus } = fakeReqRes('éé');
  let nextCalls = 0;
  createLimit({ maxBytes: 6, errorResponseFactory: () => { throw new Error('must not build'); } })(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(getStatus(), undefined);
});

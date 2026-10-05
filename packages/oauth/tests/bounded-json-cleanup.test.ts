import assert from "node:assert/strict";
import { test } from "vitest";
import { readBoundedOAuthText } from "../src/bounded-json.js";

const messages = { overflowMessage: "response too large", overflowOperatorAction: "Reduce response size." };

// F6.2: deleting cancel's catch must not replace the structured overflow with a cleanup error.
test("overflow preserves its OAuth diagnosis when stream cancellation rejects", async () => {
  let pulls = 0;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(Uint8Array.from([65, 66, 67])); },
    cancel() { cancellations++; throw new Error("cleanup failed"); },
  }, { highWaterMark: 0 });
  await assert.rejects(readBoundedOAuthText(new Response(body), messages, 2), {
    name: "OAuthError", code: "OAUTH_MALFORMED_RESPONSE", message: "response too large",
    operatorAction: "Reduce response size.", retryable: false,
  });
  assert.equal(pulls, 1);
  assert.equal(cancellations, 1);
});

// F4.3: literal 65536 is independent of the module's exported limit.
test("the default text cap accepts exactly 64 KiB and refuses one additional byte", async () => {
  assert.equal(await readBoundedOAuthText(new Response("x".repeat(65536)), messages), "x".repeat(65536));
  await assert.rejects(readBoundedOAuthText(new Response("x".repeat(65537)), messages), {
    code: "OAUTH_MALFORMED_RESPONSE", message: "response too large", operatorAction: "Reduce response size.",
  });
});

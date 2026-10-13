import assert from "node:assert/strict";
import { test } from "vitest";
import { formatAad } from "../aad.js";
test("formatAad preserves the deployed colon-separated format", () => {
    assert.equal(formatAad({ kind: "vendor-credential-set", version: "v1", parts: ["ws-1", "github", "cred-1"] }), "vendor-credential-set:v1:ws-1:github:cred-1");
});

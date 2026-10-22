import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";
import * as trust from "../trust.js";
import type { RemoteToolDescriptorAnnotations } from "../ports.js";

// Exhaustive combinations catch a remote contradiction overriding even an explicit read grant.
for (const listed of [false, true]) {
  for (const readOnlyHint of [undefined, false, true]) {
    for (const destructiveHint of [undefined, false, true]) {
      test(`operator read decision: listed=${listed}, readOnlyHint=${readOnlyHint}, destructiveHint=${destructiveHint}`, () => {
        assert.equal(typeof trust.isOperatorDeclaredReadOnly, "function", "the operator read trust decision must be exported");
        const annotations: RemoteToolDescriptorAnnotations = {
          ...(readOnlyHint === undefined ? {} : { readOnlyHint }),
          ...(destructiveHint === undefined ? {} : { destructiveHint }),
        };
        assert.equal(trust.isOperatorDeclaredReadOnly({ remoteName: "inspect", annotations: annotations, readList: new Set(listed ? ["inspect"] : []) }),
          listed && readOnlyHint !== false && destructiveHint !== true);
      });
    }
  }
}
test("missing read list and absent annotations never grant read-only from a remote hint", () => {
  assert.equal(typeof trust.isOperatorDeclaredReadOnly, "function");
  assert.equal(trust.isOperatorDeclaredReadOnly({ remoteName: "inspect", annotations: { readOnlyHint: true }, readList: undefined }), false);
  assert.equal(trust.isOperatorDeclaredReadOnly({ remoteName: "inspect", annotations: undefined, readList: new Set(["inspect"]) }), true);
});

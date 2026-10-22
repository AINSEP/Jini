import { expect, test } from "vitest";
import * as trash from "../index.js";
import { TrashAdapterMissingError } from "../write-service.js";
// PARITY: the former platform namespace exposes the same class at the CMS trash entry.
test("trash exports its missing-adapter refusal class", () => {
  expect(trash.TrashAdapterMissingError).toBe(TrashAdapterMissingError);
});

// PARITY: moved policy errors preserve message and cause options.
test("policy refusal retains message and cause", () => {
  const cause = new Error("adapter failure");
  const error = new TrashAdapterMissingError({ message: "policy refusal" }, { cause });
  expect(error.message).toBe("policy refusal");
  expect(error.cause).toBe(cause);
});

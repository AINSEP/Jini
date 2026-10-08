import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CommerceProductNotFoundError,
  CommercePriceNotFoundError,
  CommerceOrderNotFoundError,
  CommerceCheckoutValidationError,
} from "../../errors.js";

describe("commerce errors", () => {
  it("instantiates CommerceProductNotFoundError as an Error", () => {
    const err = new CommerceProductNotFoundError("Product not found");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CommerceProductNotFoundError);
    assert.equal(err.message, "Product not found");
  });

  it("instantiates CommercePriceNotFoundError as an Error", () => {
    const err = new CommercePriceNotFoundError("Price not found or inactive");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CommercePriceNotFoundError);
    assert.equal(err.message, "Price not found or inactive");
  });

  it("instantiates CommerceOrderNotFoundError as an Error", () => {
    const err = new CommerceOrderNotFoundError("Order not found");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CommerceOrderNotFoundError);
    assert.equal(err.message, "Order not found");
  });

  it("instantiates CommerceCheckoutValidationError with default and custom fieldErrors", () => {
    const defaultErr = new CommerceCheckoutValidationError({ message: "Validation failed" });
    assert.ok(defaultErr instanceof Error);
    assert.ok(defaultErr instanceof CommerceCheckoutValidationError);
    assert.equal(defaultErr.message, "Validation failed");
    assert.deepEqual(defaultErr.fieldErrors, []);

    const fieldErrors = [{ field: "quantity", reason: "must be positive" }];
    const customErr = new CommerceCheckoutValidationError({ message: "Invalid quantity", fieldErrors: fieldErrors });
    assert.equal(customErr.message, "Invalid quantity");
    assert.deepEqual(customErr.fieldErrors, fieldErrors);
  });
});

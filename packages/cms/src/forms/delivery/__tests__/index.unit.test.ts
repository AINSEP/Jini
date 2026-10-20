/**
 * @file Contract pin for the delivery barrel: hosts depend on exactly these runtime names, and
 * internal helpers (code sanitising, freezing) stay out of the package API.
 */
import { expect, test } from "vitest";
import * as delivery from "../index.js";
import * as forms from "../../index.js";

test("exports exactly the documented runtime surface", () => {
  expect(Object.keys(delivery).sort()).toEqual([
    "FORM_DELIVERY_EVENT", "FORM_DELIVERY_MAX_RETRY_AFTER_MS", "FORM_PULL_RECENT_MS", "FormDeliveryError",
    "createFormDeliverySubscriptions", "createFormPullTrigger", "deliverFormJob", "formDeliveryRetryPolicy",
    "formDeliveryStatusFromOutbox", "planFormDeliveries", "withFormPullLease",
  ]);
});

test("the child job event name is form.submission.delivery", () => {
  expect(delivery.FORM_DELIVERY_EVENT).toBe("form.submission.delivery");
});

test("the forms barrel re-exports every delivery export as the same binding", () => {
  for (const [name, value] of Object.entries(delivery)) expect(forms[name as keyof typeof forms], name).toBe(value);
});

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  NewsletterCampaignNotFoundError,
  NewsletterListNotFoundError,
  NewsletterSubscriptionNotFoundError,
  NewsletterSubscriberNotFoundError,
  NewsletterValidationError,
  NewsletterCampaignNotEditableError,
  NewsletterDefaultListProtectedError,
  NewsletterConflictError,
  NewsletterLaunchGateBlockedError,
  NewsletterConfirmTokenInvalidError,
  NewsletterUnsubscribeTokenInvalidError,
  NewsletterForbiddenError,
} from "../errors.js";

test("Newsletter basic error classes inherit from Error and preserve message", () => {
  const campaignNotFound = new NewsletterCampaignNotFoundError("campaign not found");
  assert.ok(campaignNotFound instanceof Error);
  assert.equal(campaignNotFound.message, "campaign not found");

  const listNotFound = new NewsletterListNotFoundError("list not found");
  assert.ok(listNotFound instanceof Error);
  assert.equal(listNotFound.message, "list not found");

  const subscriptionNotFound = new NewsletterSubscriptionNotFoundError("subscription not found");
  assert.ok(subscriptionNotFound instanceof Error);
  assert.equal(subscriptionNotFound.message, "subscription not found");

  const forbidden = new NewsletterForbiddenError("forbidden");
  assert.ok(forbidden instanceof Error);
  assert.equal(forbidden.message, "forbidden");
});

test("message-less newsletter lookup and authorization errors preserve their domain identities", () => {
  for (const ErrorType of [NewsletterCampaignNotFoundError, NewsletterListNotFoundError, NewsletterSubscriptionNotFoundError, NewsletterForbiddenError]) {
    const error = new ErrorType();
    assert.ok(error instanceof ErrorType);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "");
  }
});

test("NewsletterSubscriberNotFoundError stores subscriberId", () => {
  const err = new NewsletterSubscriberNotFoundError({ message: "subscriber missing", subscriberId: "sub-123" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "subscriber missing");
  assert.equal(err.subscriberId, "sub-123");
});

test("NewsletterValidationError stores field and reason", () => {
  const err = new NewsletterValidationError({ message: "invalid field", field: "email", reason: "malformed" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "invalid field");
  assert.equal(err.field, "email");
  assert.equal(err.reason, "malformed");
});

test("NewsletterCampaignNotEditableError stores currentStatus and attemptedAction", () => {
  const err = new NewsletterCampaignNotEditableError({ message: "cannot edit", currentStatus: "sent", attemptedAction: "update_body" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "cannot edit");
  assert.equal(err.currentStatus, "sent");
  assert.equal(err.attemptedAction, "update_body");
});

test("NewsletterDefaultListProtectedError stores listId", () => {
  const err = new NewsletterDefaultListProtectedError({ message: "default list protected", listId: "list-default" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "default list protected");
  assert.equal(err.listId, "list-default");
});

test("NewsletterConflictError stores entity, id, expectedVersion, and actualVersion", () => {
  const err = new NewsletterConflictError({ message: "conflict detected", entity: "campaign", id: "c-1", expectedVersion: 2, actualVersion: 3 });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "conflict detected");
  assert.equal(err.entity, "campaign");
  assert.equal(err.id, "c-1");
  assert.equal(err.expectedVersion, 2);
  assert.equal(err.actualVersion, 3);
});

test("NewsletterLaunchGateBlockedError stores unmetPreconditions array", () => {
  const preconditions = ["LIST_EMPTY", "MISSING_SUBJECT"];
  const err = new NewsletterLaunchGateBlockedError({ message: "launch blocked", unmetPreconditions: preconditions });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "launch blocked");
  assert.deepEqual(err.unmetPreconditions, preconditions);
});

test("NewsletterConfirmTokenInvalidError stores reason", () => {
  const reasons = ["expired", "already_consumed", "not_found"] as const;
  for (const reason of reasons) {
    const err = new NewsletterConfirmTokenInvalidError({ message: `token ${reason}`, reason });
    assert.ok(err instanceof Error);
    assert.equal(err.message, `token ${reason}`);
    assert.equal(err.reason, reason);
  }
});

test("NewsletterUnsubscribeTokenInvalidError stores reason", () => {
  const reasons = ["consent_revision_mismatch", "signature_invalid", "expired", "not_found"] as const;
  for (const reason of reasons) {
    const err = new NewsletterUnsubscribeTokenInvalidError({ message: `unsubscribe ${reason}`, reason });
    assert.ok(err instanceof Error);
    assert.equal(err.message, `unsubscribe ${reason}`);
    assert.equal(err.reason, reason);
  }
});

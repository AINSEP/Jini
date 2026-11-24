/**
 * @file T016 — failing-first tests for `transitionCampaignStatus` (behavior.spec.md §1.1,
 * REQ-04/05/07/18, AC-05/06/07/24).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { transitionCampaignStatus, type CampaignActorTier } from "../campaign.js";
import type { CampaignStatus } from "../types.js";

const allow = (from: CampaignStatus, to: CampaignStatus, actorTier: CampaignActorTier) =>
  transitionCampaignStatus({ from, to, actorTier });

test("pipeline tier: scheduled -> sending is allowed", () => {
  assert.equal(allow("scheduled", "sending", "pipeline").allowed, true);
});
test("pipeline tier: sending -> sent is allowed", () => {
  assert.equal(allow("sending", "sent", "pipeline").allowed, true);
});
test("non-pipeline tiers can never set status to 'sending' directly", () => {
  for (const tier of ["send", "schedule", "compose"] as const) {
    assert.equal(allow("scheduled", "sending", tier).allowed, false);
  }
});
test("non-pipeline tiers can never set status to 'sent' directly", () => {
  for (const tier of ["send", "schedule", "compose"] as const) {
    assert.equal(allow("sending", "sent", tier).allowed, false);
  }
});
test("pipeline tier: draft -> sending is rejected; paused -> sending resumes", () => {
  assert.equal(allow("draft", "sending", "pipeline").allowed, false);
  assert.equal(allow("paused", "sending", "pipeline").allowed, true); // resume path, allowed below too
});
test("pipeline tier: 'sent' rejected from any status other than 'sending'", () => {
  assert.equal(allow("scheduled", "sent", "pipeline").allowed, false);
});

test("send tier: sending <-> paused is allowed", () => {
  assert.equal(allow("sending", "paused", "send").allowed, true);
  assert.equal(allow("paused", "sending", "send").allowed, true);
});
test("send tier: cannot do anything besides sending<->paused", () => {
  assert.equal(allow("draft", "scheduled", "send").allowed, false);
  assert.equal(allow("draft", "canceled", "send").allowed, false);
});
test("schedule/compose tiers cannot pause/resume", () => {
  assert.equal(allow("sending", "paused", "schedule").allowed, false);
  assert.equal(allow("sending", "paused", "compose").allowed, false);
});

test("schedule tier: draft -> scheduled is allowed", () => {
  assert.equal(allow("draft", "scheduled", "schedule").allowed, true);
});
test("compose tier attempting draft -> scheduled directly is REJECTED (dedicated SCHEDULE_CAMPAIGN endpoint only)", () => {
  const result = allow("draft", "scheduled", "compose");
  assert.equal(result.allowed, false);
});
test("send/pipeline tiers cannot schedule", () => {
  assert.equal(allow("draft", "scheduled", "send").allowed, false);
  assert.equal(allow("draft", "scheduled", "pipeline").allowed, false);
});

test("compose tier: draft -> canceled and scheduled -> canceled are allowed", () => {
  assert.equal(allow("draft", "canceled", "compose").allowed, true);
  assert.equal(allow("scheduled", "canceled", "compose").allowed, true);
});
test("compose tier attempting to set status:'sent' directly is rejected (the canonical compose-tier violation case)", () => {
  const result = allow("sending", "sent", "compose");
  assert.equal(result.allowed, false);
  assert.match(result.allowed === false ? result.reason : "", /pipeline/);
});
test("non-compose tiers cannot cancel", () => {
  assert.equal(allow("draft", "canceled", "schedule").allowed, false);
  assert.equal(allow("scheduled", "canceled", "send").allowed, false);
});

test("a same-status transition is always rejected as a no-op, regardless of tier", () => {
  assert.equal(allow("draft", "draft", "compose").allowed, false);
});
test("an unrecognized transition (e.g. canceled -> draft) is rejected for every tier", () => {
  for (const tier of ["pipeline", "send", "schedule", "compose"] as const) {
    assert.equal(allow("canceled", "draft", tier).allowed, false);
  }
});

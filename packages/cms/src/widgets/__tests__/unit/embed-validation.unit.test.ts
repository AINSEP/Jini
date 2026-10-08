import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { validateWidgetEmbedMutation } from "../../embed-validation.js";
import type { WidgetEmbedNode } from "../../types.js";

/**
 * @file C-008 `validateWidgetEmbedMutation` — SPEC-043 REQ-19/20, INV-04.
 * TDD-certified against the stub in `embed-validation.ts`; currently RED (the
 * function throws "not implemented") — these assertions describe the contract
 * the Programmer stage must satisfy, not current behavior.
 */

function embed(overrides: Partial<WidgetEmbedNode> = {}): WidgetEmbedNode {
  return {
    type: "widgetEmbed",
    placementId: "plc-1",
    widgetEntryId: "widget-1",
    ...overrides,
  };
}

test("REQ-19/INV-04: rejects a widgetEmbed mutation whose host entry is itself a widget instance (no recursion)", () => {
  const result = validateWidgetEmbedMutation({
    hostEntryType: "widget",
    resultingEmbeds: [embed()],
    maxEmbedsPerDocument: 50,
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.reason, "recursion");
  }
});

test("REQ-19/INV-04: accepts a widgetEmbed mutation on a non-widget host entry (e.g. a page)", () => {
  const result = validateWidgetEmbedMutation({
    hostEntryType: "page",
    resultingEmbeds: [embed()],
    maxEmbedsPerDocument: 50,
  });

  assert.equal(result.valid, true);
});

test("REQ-20: rejects a mutation that would exceed the configured per-document embed count", () => {
  const overLimit = Array.from({ length: 51 }, (_, i) => embed({ placementId: `plc-${i}` }));

  const result = validateWidgetEmbedMutation({
    hostEntryType: "page",
    resultingEmbeds: overLimit,
    maxEmbedsPerDocument: 50,
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.reason, "count-exceeded");
  }
});

test("REQ-20: accepts a mutation exactly at the configured per-document embed count", () => {
  const atLimit = Array.from({ length: 50 }, (_, i) => embed({ placementId: `plc-${i}` }));

  const result = validateWidgetEmbedMutation({
    hostEntryType: "page",
    resultingEmbeds: atLimit,
    maxEmbedsPerDocument: 50,
  });

  assert.equal(result.valid, true);
});

test("INV-04: recursion is rejected regardless of how deeply the widgetEmbed is nested inside the widget's bodyJson", () => {
  // The validator receives the flattened list of resulting embeds for the host entry — nesting
  // depth inside bodyJson must not matter, only whether the host entry type is 'widget' at all.
  const result = validateWidgetEmbedMutation({
    hostEntryType: "widget",
    resultingEmbeds: [embed({ placementId: "deeply-nested" })],
    maxEmbedsPerDocument: 50,
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.reason, "recursion");
  }
});

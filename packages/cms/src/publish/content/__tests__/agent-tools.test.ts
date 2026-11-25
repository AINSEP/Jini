import assert from "node:assert/strict";
import { test } from "vitest";

import { publishContentAgentToolCatalog } from "../agent-tools.js";
import { toolMetadata } from "../tool-metadata.js";

test("publish guidance checks readiness and gives an exact item key before describing publish-all", () => {
  const publish = publishContentAgentToolCatalog.find((tool) => tool.name === "publish_content_publish");
  assert.ok(publish);
  const { description } = publish;
  assert.ok(description.includes("publish_content_status"));
  assert.ok(description.includes("items"));
  assert.ok(description.includes("everything pending"));
  assert.ok(description.indexOf("publish_content_status") < description.indexOf("items"));
  assert.ok(description.indexOf("items") < description.indexOf("everything pending"));
  assert.ok(description.includes('resolve its exact key and pass it in items, such as "page:<id>"'));
  assert.ok(description.includes("Publish everything pending only when the owner explicitly asks for everything."));
});

test("scoped guidance keeps the publish card and overwrite instructions", () => {
  const publish = publishContentAgentToolCatalog.find((tool) => tool.name === "publish_content_publish");
  assert.ok(publish);
  assert.ok(publish.description.includes("Set overwrite:true ONLY when the user explicitly asks to replace conflicting live content; defaults to skipping conflicts and reporting why. "));
  assert.ok(publish.description.includes("Waits for a human confirmation card (owner 2026-10-07). Returns published items with live publicUrl, skipped items with reasons, unchanged items, and verification problems. "));
  assert.ok(publish.description.includes("Give the live publicUrl first in your reply; an admin edit link is secondary. Never invent a live link or claim unverified items landed."));
  assert.deepEqual(toolMetadata.publish_content_publish.approval, { class: "publish", confirmation: "policy" });
});

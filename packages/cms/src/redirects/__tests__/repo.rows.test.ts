import assert from "node:assert/strict";
import { test } from "vitest";
import { toRevision, toRevisionRow } from "../sql/repo.rows.js";
import type { RedirectRecord } from "../types.js";

const state: RedirectRecord = { id: "r1", workspaceId: "ws", matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 308,
  status: "disabled", override: true, priority: 7, source: "manual", createdByPrincipal: "operator", createdAt: "created", updatedAt: "updated", version: 4 };
const text = '{"id":"r1","workspaceId":"ws","matchType":"exact","fromPattern":"/old","toTarget":"/new","statusCode":308,"status":"disabled","override":true,"priority":7,"source":"manual","createdByPrincipal":"operator","createdAt":"created","updatedAt":"updated","version":4}';

test("redirect revision persists plugin attribution, tombstone and exact compact state", () => {
  assert.deepEqual(toRevisionRow({ revision: { redirectId: "r1", workspaceId: "ws", seq: 4, state, tombstoned: true, actorId: "agent", pluginId: "redirect-plugin", recordedAt: "recorded" } }, {}),
    { redirect_id: "r1", workspace_id: "ws", seq: 4, state_json: text, tombstoned: 1, actor_id: "agent", plugin_id: "redirect-plugin", recorded_at: "recorded" });
  assert.deepEqual(toRevision({ row: { id: 17, redirect_id: "r1", workspace_id: "ws", seq: 4, state_json: text, tombstoned: 1,
    actor_id: "agent", plugin_id: "redirect-plugin", recorded_at: "recorded" } }, {}),
    { redirectId: "r1", workspaceId: "ws", seq: 4, state, tombstoned: true, actorId: "agent", pluginId: "redirect-plugin", recordedAt: "recorded" });
});
test("an ordinary redirect revision preserves false and normalizes absent plugin attribution", () => {
  const row = toRevisionRow({ revision: { redirectId: "r1", workspaceId: "ws", seq: 1, state, tombstoned: false, actorId: "human", recordedAt: "recorded" } }, {});
  assert.equal(row.tombstoned, 0);
  assert.equal(row.plugin_id, null);
  assert.deepEqual(toRevision({ row: { id: 18, redirect_id: "r1", workspace_id: "ws", seq: 1, state_json: text, tombstoned: 0,
    actor_id: "human", plugin_id: null, recorded_at: "recorded" } }, {}),
    { redirectId: "r1", workspaceId: "ws", seq: 1, state, tombstoned: false, actorId: "human", pluginId: undefined, recordedAt: "recorded" });
});

import assert from "node:assert/strict";
import test from "node:test";

import { toWebhookEventRow } from "../../repo.rows.js";

test("webhook row preserves provider event identity, raw payload and independent occurrence and receipt times", () => {
  // F1.2/F4.3: existing inbox tests check status but would miss a dropped payload or swapped times.
  assert.deepEqual(toWebhookEventRow({ id: "inbox-a", workspaceId: "ws-a", provider: "regional-pay", eventId: "provider-123", eventType: "payment.failed", eventOccurredAt: "2026-09-29T10:00:00Z", payload: '{"amount":2701,"reason":"declined"}', status: "received", receivedAt: "2026-10-01T11:00:00Z" }), {
    id: "inbox-a", workspace_id: "ws-a", provider: "regional-pay", event_id: "provider-123", event_type: "payment.failed", event_occurred_at: "2026-09-29T10:00:00Z", payload_json: '{"amount":2701,"reason":"declined"}', status: "received", received_at: "2026-10-01T11:00:00Z",
  });
});

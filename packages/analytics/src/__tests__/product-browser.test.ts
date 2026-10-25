import { expect, test, vi } from "vitest";

// A browser has no Node crypto implementation. Fail at module evaluation if the universal
// product entry ever follows the visitor-ingest hashing/salt imports again (obs2 #4).
vi.mock("node:crypto", () => { throw new Error("Node crypto reached the universal product entry"); });

test("the product entry imports and validates events without Node crypto shims", async () => {
  const { withProductAnalyticsGuards } = await import("../product/index.js");
  const events: unknown[] = [];
  const port = withProductAnalyticsGuards({
    inner: { capture: (event) => { events.push(event); }, identify: () => {} },
    consent: () => true,
  });
  port.capture({ name: "assistant_tool_call", userId: "u1", properties: { ok: true } });
  port.capture({ name: "assistant_tool_call", userId: "u1", properties: { email: "private" } });
  expect(events).toEqual([{ name: "assistant_tool_call", userId: "u1", properties: { ok: true } }]);
});

// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { publishAdminPageSurface, subscribeToAdminPageSurfaces } from "../admin-frontend-session.js";
import { resetAssistantDockBus, subscribeToAssistantDockRequests } from "../assistant-dock-bus.js";

afterEach(resetAssistantDockBus);

it("requests the dock before delivering the exact page surface and stops delivering to disposed panes", () => {
  const deliveries: unknown[][] = [];
  subscribeToAssistantDockRequests({ listener: open => { deliveries.push(["dock", open]); } });
  const stopFirst = subscribeToAdminPageSurfaces(emission => { deliveries.push(["first pane", emission]); });
  const stopSecond = subscribeToAdminPageSurfaces(emission => { deliveries.push(["second pane", emission]); });
  try {
    const first = { channel: "confirm", payload: { id: "remove-1", title: "Remove draft?" } };
    const second = { channel: "confirm", payload: { id: "remove-2", title: "Remove attachment?" } };
    publishAdminPageSurface({ emission: first });
    stopFirst();
    publishAdminPageSurface({ emission: second });
    expect(deliveries).toEqual([["dock", true], ["first pane", first], ["second pane", first], ["dock", true], ["second pane", second]]);
  } finally { stopFirst(); stopSecond(); }
});

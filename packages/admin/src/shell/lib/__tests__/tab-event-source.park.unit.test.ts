import { expect, it } from "vitest";
import { openTabEventSource } from "../tab-event-source.js";
import { createStreamActivity } from "../stream-activity.js";
import { fakeBrowserOrigin, StreamFake } from "./browser-stream.fakes.js";

it("named parked events reach the bridge", () => {
  const tab = fakeBrowserOrigin().tab();
  const native = new StreamFake("/api/frontend-sessions/stream");
  const managed = openTabEventSource({ url: native.url }, { open: () => native, ports: tab.ports, activity: createStreamActivity({}) });
  const frames: unknown[] = [];
  managed.addEventListener("parked", event => frames.push({
    data: (event as MessageEvent).data, id: (event as MessageEvent).lastEventId,
  }));
  let opened = 0; managed.onopen = () => { opened++; };
  native.emit("parked", '{"reason":"idle"}', "park-1");
  expect(frames).toEqual([{ data: '{"reason":"idle"}', id: "park-1" }]);
  expect(opened).toBe(0);
  managed.close();
  native.dispatchEvent(new MessageEvent("parked", { data: "late" }));
  expect(frames).toHaveLength(1);
});

import assert from "node:assert/strict";
import { test } from "vitest";

import { subscribeGlueEvent } from "../attachment-points/events.js";



const handler = async (_payload: unknown) => {};

test("forwards moduleId, eventName, and handler to hostPort.subscribeEvent() unchanged", () => {
  const calls: unknown[][] = [];
  const hostPort = {
    subscribeEvent: (...args: unknown[]) => {
      calls.push(args);
    },
  };

  subscribeGlueEvent({ moduleId: "site-glue-example", eventName: "content.entry.published", handler, hostPort });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!, [{ moduleId: "site-glue-example", eventName: "content.entry.published", handler }]);
});

test("propagates whatever hostPort.subscribeEvent() itself throws, rather than swallowing it", () => {
  const hostPort = {
    subscribeEvent: () => {
      throw new Error("host port refused this subscription");
    },
  };

  assert.throws(
    () => subscribeGlueEvent({ moduleId: "m", eventName: "some.event", handler, hostPort }),
    /host port refused this subscription/
  );
});

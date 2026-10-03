import assert from "node:assert/strict";
import { test } from "vitest";

import { attachGlueContentLifecycle } from "../attachment-points/content-lifecycle.js";
import type { GlueFieldDecl } from "../ports.js";



const fields: readonly GlueFieldDecl[] = [{ path: "count", type: "integer" }];
const filter = async () => ({ count: 1 });

test("forwards moduleId, filter, and declaredFields to hostPort.attachContentLifecycleFilter() unchanged", () => {
  const calls: unknown[][] = [];
  const hostPort = {
    attachContentLifecycleFilter: (...args: unknown[]) => {
      calls.push(args);
    },
  };

  attachGlueContentLifecycle({ moduleId: "site-glue-example", filter, declaredFields: fields, hostPort });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!, [{ moduleId: "site-glue-example", filter, declaredFields: fields }]);
});

test("ADR-057 Decision 4: this category stays fail-closed — a throw from the host port propagates, never caught here", () => {
  const hostPort = {
    attachContentLifecycleFilter: () => {
      throw new Error("host port refused this attachment");
    },
  };

  assert.throws(
    () => attachGlueContentLifecycle({ moduleId: "m", filter, declaredFields: fields, hostPort }),
    /host port refused this attachment/
  );
});

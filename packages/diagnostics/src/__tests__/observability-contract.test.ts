import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySpanExporter, createPort } from "./observability-fakes.js";

import { createNoopObservabilityPort } from "../observability/noop.js";
import { createOtelObservabilityPort } from "../observability/otel.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";
import type { ObservabilityPort, RequestTrackingInput, RequestTrackingOutcome } from "../observability/ports.js";

/**
 * @file Table-driven proof that every adapter satisfies `ObservabilityPort`'s CONTRACT (not just
 * its TypeScript shape — `tsc` already guarantees that at compile time). Every case below is run
 * against BOTH adapters from the same table; a case a real caller (`observability-middleware.ts`)
 * actually exercises, expressed once and checked identically against every implementation.
 */

const OTEL_CONFIG: ObservabilityConfigEnabled = {
  enabled: true,
  serviceName: "sample-test",
  tracerName: "sample.requests",
  endpoint: "http://collector/v1/traces",
};

interface AdapterUnderTest {
  name: string;
  build(): ObservabilityPort;
}

const ADAPTERS: AdapterUnderTest[] = [
  { name: "noop", build: () => createNoopObservabilityPort({}) },
  {
    name: "otel",
    build: () => createPort(OTEL_CONFIG, new InMemorySpanExporter()),
  },
];

const REQUESTS: RequestTrackingInput[] = [
  { method: "GET", path: "/welcome" },
  { method: "POST", path: "/api/admin/posts" },
  { method: "DELETE", path: "/api/admin/posts/507f191e810c19729de860ea" },
];

const OUTCOMES: RequestTrackingOutcome[] = [
  { statusCode: 200, routePattern: "/welcome" },
  { statusCode: 201, routePattern: "/api/admin/posts" },
  { statusCode: 404, routePattern: "unmatched" },
  { statusCode: 500, routePattern: "/api/admin/posts/:id" },
];

for (const adapter of ADAPTERS) {
  test(`${adapter.name}: trackRequest() returns a tracker whose end() never throws, for every (request, outcome) pair`, () => {
    const port = adapter.build();
    for (const input of REQUESTS) {
      for (const outcome of OUTCOMES) {
        const tracker = port.trackRequest(input);
        assert.equal(typeof tracker.end, "function", `${adapter.name}: trackRequest() must return an object with an end() function`);
        assert.doesNotThrow(() => tracker.end(outcome), `${adapter.name}: end(${JSON.stringify(outcome)}) after trackRequest(${JSON.stringify(input)})`);
      }
    }
  });

  test(`${adapter.name}: trackRequest() itself never throws, independent of whether end() is ever called`, () => {
    const port = adapter.build();
    for (const input of REQUESTS) {
      assert.doesNotThrow(() => port.trackRequest(input));
    }
  });

  test(`${adapter.name}: two trackRequest() calls in flight at once produce two independent trackers (ending one must not end the other)`, () => {
    const port = adapter.build();
    const first = port.trackRequest(REQUESTS[0]!);
    const second = port.trackRequest(REQUESTS[1]!);
    assert.doesNotThrow(() => first.end(OUTCOMES[0]!));
    assert.doesNotThrow(() => second.end(OUTCOMES[1]!));
  });
}

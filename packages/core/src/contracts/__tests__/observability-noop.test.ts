import assert from "node:assert/strict";
import { test } from "vitest";

import { createNoopObservabilityPort, isNoopObservabilityPort } from "../observability.js";

/**
 * @file The no-op port is the default almost every self-hosted install actually runs
 * (`config.ts`'s `resolveObservabilityConfig` is off unless an operator sets
 * `OTEL_EXPORTER_OTLP_ENDPOINT`), so "does nothing" is itself the behavior under test — per this
 * task's own guardrail ("a no-op that accidentally does work is a real bug"), these assertions are
 * about absence of effect and absence of allocation, not about a return value.
 */

test("trackRequest().end() never throws, regardless of input shape", () => {
  const port = createNoopObservabilityPort({});
  const tracker = port.trackRequest({ method: "GET", path: "/anything" });
  assert.doesNotThrow(() => tracker.end({ statusCode: 200, routePattern: "/anything" }));
});

test("end() may be called any number of times without throwing (real Express `res.on('finish')` fires once, but the no-op contract itself does not depend on that)", () => {
  const port = createNoopObservabilityPort({});
  const tracker = port.trackRequest({ method: "POST", path: "/x" });
  tracker.end({ statusCode: 500, routePattern: "/x" });
  assert.doesNotThrow(() => tracker.end({ statusCode: 500, routePattern: "/x" }));
});

test("every trackRequest() call returns the SAME tracker instance — proves no per-call allocation, the cost guarantee the no-op port exists for", () => {
  const port = createNoopObservabilityPort({});
  const first = port.trackRequest({ method: "GET", path: "/a" });
  const second = port.trackRequest({ method: "GET", path: "/b" });
  assert.equal(first, second);
});

test("the returned tracker is frozen — end cannot be reassigned to add real work later by accident (ESM modules are always strict mode, so a frozen-property write throws rather than silently no-opping)", () => {
  const port = createNoopObservabilityPort({});
  const tracker = port.trackRequest({ method: "GET", path: "/a" });
  assert.throws(() => {
    (tracker as { end: unknown }).end = () => {
      throw new Error("should never run");
    };
  });
});

test("every call returns the one shared frozen port, so a disabled install allocates no port at all", () => {
  const first = createNoopObservabilityPort({});
  assert.equal(createNoopObservabilityPort({}), first);
  assert.ok(Object.isFrozen(first));
});

test("isNoopObservabilityPort is true for the shared port and false for a hand-built or spread copy", () => {
  const shared = createNoopObservabilityPort({});
  assert.equal(isNoopObservabilityPort(shared), true);
  assert.equal(isNoopObservabilityPort({ ...shared }), false);
  assert.equal(isNoopObservabilityPort({ ...shared, supportsMetric: true }), false);
});

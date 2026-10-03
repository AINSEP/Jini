import assert from "node:assert/strict";
import { test } from "vitest";

import { SpanKind, SpanStatusCode } from "./observability-fakes.js";
import { InMemorySpanExporter, createPort } from "./observability-fakes.js";

import { createOtelObservabilityPort } from "../observability/otel.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";

/** Request-span characterization cases run against injected trace/exporter ports, without loading an SDK. */

const TEST_CONFIG: ObservabilityConfigEnabled = {
  enabled: true,
  serviceName: "sample-test",
  tracerName: "sample.requests",
  endpoint: "http://collector/v1/traces",
};

function createPortUnderTest(): { port: ReturnType<typeof createOtelObservabilityPort>; exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter();
  const port = createPort(TEST_CONFIG, exporter);
  return { port, exporter };
}

test("end() exports exactly one span per trackRequest() call", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/welcome" });
  assert.equal(exporter.getFinishedSpans().length, 0, "the span must not be exported before end() is called");

  tracker.end({ statusCode: 200, routePattern: "/welcome" });

  assert.equal(exporter.getFinishedSpans().length, 1);
});

test("the exported span's name combines the method and the FINAL route pattern from end(), not the raw path known at trackRequest() time", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/posts/507f191e810c19729de860ea" });
  tracker.end({ statusCode: 200, routePattern: "/api/admin/posts/:id" });

  const [span] = exporter.getFinishedSpans();
  assert.equal(span!.name, "GET /api/admin/posts/:id");
});

test("attributes carry method, target, matched route, and status code; kind is SERVER", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "POST", path: "/api/admin/posts" });
  tracker.end({ statusCode: 201, routePattern: "/api/admin/posts" });

  const [span] = exporter.getFinishedSpans();
  assert.equal(span!.kind, SpanKind.SERVER);
  assert.equal(span!.attributes["http.method"], "POST");
  assert.equal(span!.attributes["http.target"], "/api/admin/posts");
  assert.equal(span!.attributes["http.route"], "/api/admin/posts");
  assert.equal(span!.attributes["http.status_code"], 201);
});

test("a 5xx outcome sets the span status to ERROR", () => {
  const { port, exporter } = createPortUnderTest();
  const tracker = port.trackRequest({ method: "GET", path: "/boom" });
  tracker.end({ statusCode: 503, routePattern: "unmatched" });

  const [span] = exporter.getFinishedSpans();
  assert.equal(span!.status.code, SpanStatusCode.ERROR);
});

test("a 2xx/4xx outcome leaves the span status UNSET — errors are reserved for 5xx, matching the port's contract (client errors are not server failures)", () => {
  const { port, exporter } = createPortUnderTest();
  const okTracker = port.trackRequest({ method: "GET", path: "/ok" });
  okTracker.end({ statusCode: 200, routePattern: "/ok" });
  const notFoundTracker = port.trackRequest({ method: "GET", path: "/missing" });
  notFoundTracker.end({ statusCode: 404, routePattern: "unmatched" });

  const [okSpan, notFoundSpan] = exporter.getFinishedSpans();
  assert.equal(okSpan!.status.code, SpanStatusCode.UNSET);
  assert.equal(notFoundSpan!.status.code, SpanStatusCode.UNSET);
});

test("multiple concurrent trackRequest() calls produce independently-attributed spans — one call's outcome never leaks into another's", () => {
  const { port, exporter } = createPortUnderTest();
  const first = port.trackRequest({ method: "GET", path: "/a" });
  const second = port.trackRequest({ method: "GET", path: "/b" });

  second.end({ statusCode: 500, routePattern: "/b" });
  first.end({ statusCode: 200, routePattern: "/a" });

  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  const spanA = spans.find((s) => s.name === "GET /a");
  const spanB = spans.find((s) => s.name === "GET /b");
  assert.equal(spanA?.status.code, SpanStatusCode.UNSET);
  assert.equal(spanB?.status.code, SpanStatusCode.ERROR);
});

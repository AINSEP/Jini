import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveObservabilityConfig } from "../observability/config.js";
const names = { serviceName: "sample", tracerName: "sample.requests" };
test("no explicit endpoint disables telemetry", () => assert.deepEqual(resolveObservabilityConfig(names), { enabled: false }));
test("blank endpoints disable telemetry", () => assert.deepEqual(resolveObservabilityConfig(names, { endpoint: "", tracesEndpoint: "   " }), { enabled: false }));
test("general endpoint appends the traces path", () => assert.deepEqual(resolveObservabilityConfig(names, { endpoint: "http://collector:4318/" }), { enabled: true, ...names, endpoint: "http://collector:4318/v1/traces" }));
test("per-signal endpoint is used verbatim and takes precedence", () => assert.deepEqual(resolveObservabilityConfig(names, { endpoint: "http://ignored", tracesEndpoint: "http://collector/custom" }), { enabled: true, ...names, endpoint: "http://collector/custom" }));
test("names are explicit and validated when enabled", () => {
 assert.throws(() => resolveObservabilityConfig({ serviceName: "", tracerName: "x" }, { endpoint: "http://collector" }), /serviceName/);
 assert.throws(() => resolveObservabilityConfig({ serviceName: "x", tracerName: " " }, { endpoint: "http://collector" }), /tracerName/);
});

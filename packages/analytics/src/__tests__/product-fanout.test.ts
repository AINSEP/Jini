import { expect, it } from "vitest";
import { fanOutProductAnalytics, type ProductAiGeneration, type ProductAnalyticsPort, type ProductEvent } from "../product/index.js";

it("awaits and contains a rejected AI generation while every healthy provider receives metadata", async () => {
  let failures = 0;
  const received: ProductAiGeneration[] = [];
  const event = { userId: "owner", properties: { model: "fixture" }, input: "private prompt" };
  const port = fanOutProductAnalytics({ ports: [
    { capture() {}, identify() {}, captureAiGeneration: () => Promise.reject(new Error("private SDK detail")) },
    { capture() {}, identify() {}, captureAiGeneration: value => { received.push(value); } },
  ] }, { onFailure: () => { failures++; } });
  await port.captureAiGeneration!(event);
  expect(failures).toBe(1);
  expect(received).toEqual([{ userId: "owner", properties: { model: "fixture" } }]);
});

it("fans out events and identities, contains a broken provider, and reports fixed diagnostics through the hook", () => {
  const received: unknown[] = [];
  let failures = 0;
  const broken: ProductAnalyticsPort = { capture() { throw new Error("unavailable"); }, identify() { throw new Error("unavailable"); } };
  const good: ProductAnalyticsPort = { capture: (event) => { received.push(event); }, identify: (identity) => { received.push(identity); } };
  const port = fanOutProductAnalytics({ ports: [broken, good] }, { onFailure: () => { failures++; } });
  port.capture({ name: "post_created", userId: "p-1" });
  port.identify({ userId: "p-1" });
  expect(received).toEqual([{ name: "post_created", userId: "p-1" }, { userId: "p-1" }]);
  expect(failures).toBe(2);
});

it("checks each generation destination's content opt-in at delivery time", () => {
  const received: ProductAiGeneration[] = [];
  let include = true;
  const full: ProductAnalyticsPort = { capture() {}, identify() {}, get includeAiContent() { return include; }, captureAiGeneration: (event) => { received.push(event); } };
  const metadata: ProductAnalyticsPort = { capture() {}, identify() {}, captureAiGeneration: (event) => { received.push(event); } };
  const port = fanOutProductAnalytics({ ports: [full, metadata] });
  const event = { userId: "site-1", properties: { traceId: "run-1" }, input: "Hello", output: "Welcome" };
  port.captureAiGeneration!(event);
  include = false;
  expect(port.includeAiContent).toBe(false);
  port.captureAiGeneration!(event);
  expect(received).toEqual([event, { userId: "site-1", properties: { traceId: "run-1" } },
    { userId: "site-1", properties: { traceId: "run-1" } }, { userId: "site-1", properties: { traceId: "run-1" } }]);
});

it("contains rejected deliveries and failing diagnostic hooks without blocking other providers", async () => {
  const events: ProductEvent[] = [];
  const broken: ProductAnalyticsPort = { capture: () => Promise.reject(new Error("offline")), identify() {} };
  const good: ProductAnalyticsPort = { capture: (event) => { events.push(event); }, identify() {} };
  const port = fanOutProductAnalytics({ ports: [broken, good] }, { onFailure: () => { throw new Error("logger offline"); } });
  port.capture({ name: "post_created", userId: "p-1" });
  await Promise.resolve();
  expect(events).toEqual([{ name: "post_created", userId: "p-1" }]);
});

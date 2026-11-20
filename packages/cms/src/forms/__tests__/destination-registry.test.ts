import assert from "node:assert/strict";
import { test } from "vitest";

import { buildFormDestinationRegistry } from "../destination-registry.js";
import type { FormDestinationDescriptor, FormDestinationModule, LoadedFormDestination } from "../destination-contracts.js";

const cohosted = { id: "co", label: "Co", module: "d/co.mjs", receive: "co-hosted", hosts: ["host-a"] };
const receiving: FormDestinationModule = { pull: async () => ({ items: [], nextAfter: 0, hasMore: false }), ack: async () => ({ acknowledged: 0 }) };
const loaded = (descriptor: FormDestinationDescriptor, pluginId: string, module: FormDestinationModule = receiving): LoadedFormDestination => ({ descriptor, pluginId, module });

test("a module missing what its receive mode needs is dropped with the reason", () => {
  const registry = buildFormDestinationRegistry({ refusals: ["earlier refusal"], loaded: [
    loaded(cohosted as FormDestinationDescriptor, "p1", { pull: receiving.pull }),
    loaded({ id: "relay", label: "R", module: "r.mjs", receive: "external" }, "p2"),
    loaded({ id: "push", label: "P", module: "p.mjs" }, "p3", {}),
    loaded({ id: "ok-push", label: "P", module: "p.mjs" }, "p4", { deliver: async () => undefined }),
  ] });
  assert.deepEqual(registry.list().map((entry) => entry.descriptor.id), ["ok-push"]);
  assert.deepEqual(registry.refusals, [
    "earlier refusal",
    "form destination 'co' from 'p1' was not loaded: a destination that receives submissions needs pull() and ack()",
    "form destination 'relay' from 'p2' was not loaded: an external receiver needs prepare()",
    "form destination 'push' from 'p3' was not loaded: a destination that does not receive submissions needs deliver()",
  ]);
});

test("an id two plugins declare, and a host two co-hosted destinations claim, are dropped for both", () => {
  const registry = buildFormDestinationRegistry({ refusals: [], loaded: [
    loaded(cohosted as FormDestinationDescriptor, "p2"),
    loaded(cohosted as FormDestinationDescriptor, "p1"),
    loaded({ id: "one", label: "1", module: "1.mjs", receive: "co-hosted", hosts: ["shared", "only-one"] }, "p3"),
    loaded({ id: "two", label: "2", module: "2.mjs", receive: "co-hosted", hosts: ["shared"] }, "p4"),
    loaded({ id: "three", label: "3", module: "3.mjs", receive: "co-hosted", hosts: ["host-c", "host-c"] }, "p5"),
  ] });
  assert.deepEqual(registry.list().map((entry) => entry.descriptor.id), ["three"]);
  assert.deepEqual(registry.refusals, [
    "form destination 'co' was not loaded: more than one plugin declares it ('p1', 'p2')",
    "form receiver for host 'shared' was not loaded: more than one co-hosted destination claims it ('p3', 'p4')",
  ]);
  assert.equal(registry.resolve({ scope: "only-one" }), undefined, "a dropped destination resolves nothing, even for its unshared host");
});

test("resolve maps a saved scope by destination id or by co-hosted host; get is by id only", () => {
  const relay = loaded({ id: "relay", label: "R", module: "r.mjs", receive: "external" }, "p2", { ...receiving, prepare: async () => ({ submitUrl: "https://r.example" }) });
  const registry = buildFormDestinationRegistry({ refusals: [], loaded: [loaded(cohosted as FormDestinationDescriptor, "p1"), relay] });
  assert.equal(registry.resolve({ scope: "host-a" })?.descriptor.id, "co");
  assert.equal(registry.resolve({ scope: "relay" }), relay);
  assert.equal(registry.resolve({ scope: "co" })?.descriptor.id, "co");
  assert.equal(registry.resolve({ scope: "unknown" }), undefined);
  assert.equal(registry.get("host-a"), undefined);
  assert.equal(registry.get("relay"), relay);
});


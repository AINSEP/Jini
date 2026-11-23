import assert from "node:assert/strict";
import { test } from "vitest";

import { buildFormDestinationRegistry } from "../../index.js";
import { selectFormReceiver } from "../select.js";
import type { FormDestinationDescriptor, FormDestinationModule } from "../../index.js";

/** @file Receiver selection from the site's `core.forms` `receiver` setting and the publish's host. */

const receiving: FormDestinationModule = { pull: async () => ({ items: [], nextAfter: 0, hasMore: false }), ack: async () => ({ acknowledged: 0 }) };
const entry = (descriptor: FormDestinationDescriptor, module: FormDestinationModule = receiving) => ({ descriptor, pluginId: "p", module });
const registry = buildFormDestinationRegistry({ refusals: [], loaded: [
  entry({ id: "co", label: "Co", module: "co.mjs", receive: "co-hosted", hosts: ["host-a", "host-b"] }),
  entry({ id: "relay", label: "Relay", module: "relay.mjs", receive: "external" }, { ...receiving, prepare: async () => ({ submitUrl: "https://relay.example" }) }),
  entry({ id: "sheet", label: "Sheet", module: "sheet.mjs" }, { deliver: async () => undefined }),
] });
const pick = (setting: string | undefined, hostingTargetId = "host-a") => {
  const selection = selectFormReceiver({ registry, setting, hostingTargetId });
  return "destination" in selection ? { kind: selection.kind, id: selection.destination.descriptor.id, scope: selection.scope } : selection;
};

test("auto (and unset or blank) picks the co-hosted destination for this host, scoped to the host", () => {
  for (const setting of [undefined, "", "  ", "auto"]) assert.deepEqual(pick(setting, "host-b"), { kind: "co-hosted", id: "co", scope: "host-b" }, String(setting));
});

test("auto with no co-hosted destination for this host receives nothing and says why", () => {
  assert.deepEqual(pick("auto", "host-z"), { kind: "none", reason: "no installed form destination receives submissions on hosting target host-z" });
  assert.deepEqual(selectFormReceiver({ registry: buildFormDestinationRegistry({ refusals: [], loaded: [] }), setting: undefined, hostingTargetId: "host-a" }).kind, "none");
});

test("none turns receiving off", () => {
  assert.deepEqual(pick("none"), { kind: "none", reason: "the site's form receiver setting (core.forms receiver) is none" });
});

test("a named external destination is used on any host, scoped to its own id", () => {
  assert.deepEqual(pick("relay", "host-z"), { kind: "external", id: "relay", scope: "relay" });
});

test("a named co-hosted destination works on its hosts and is refused elsewhere, with the next step", () => {
  assert.deepEqual(pick("co", "host-a"), { kind: "co-hosted", id: "co", scope: "host-a" });
  assert.deepEqual(pick("co", "host-z"), { kind: "refused", message: "form destination 'co' receives submissions only on host-a, host-b, not on host-z. Publish to one of those hosts, or set the site's form receiver (core.forms receiver) to auto or none, then publish again" });
});

test("an unknown id and a push-only destination are refused rather than losing submissions", () => {
  assert.deepEqual(pick("missing"), { kind: "refused", message: "form destination 'missing' is not installed, or its plugin is turned off. Turn the plugin on, or set the site's form receiver (core.forms receiver) to auto or none, then publish again" });
  assert.deepEqual(pick("sheet"), { kind: "refused", message: "form destination 'sheet' does not receive browser submissions. Set the site's form receiver (core.forms receiver) to auto or to a destination that receives them, then publish again" });
});

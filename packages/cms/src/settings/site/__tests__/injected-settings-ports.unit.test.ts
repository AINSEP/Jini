import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySettingsRepo, type ensureSettingDefinitions, type getEffective } from "@jini-ai/core/settings";

import { ADMIN_INTERFACE_NAMESPACE, ensureAdminInterfaceSettingDefinitions } from "../admin-interface.js";
import { ensureChartProviderSetting } from "../chart-provider.js";
import { ensureFormDeliverySettings, readFormDeliveryBindings, readFormsAutoPull } from "../form-delivery.js";
import { ensureFormDestinationSetting, readFormDestinationSetting } from "../form-destination.js";
import { ensureMailSenderSettings, MAIL_SENDER_EMAIL_KEY, MAIL_SENDER_NAME_KEY, MAIL_SENDER_NAMESPACE, readMailSenderSetting } from "../mail-sender.js";

/**
 * @file The site settings helpers register and read through the collaborators the host injects
 * (`deps.ensureSettingDefinitions`, `required.getEffective`), never through a module import: a spy
 * passed in is the one called, with the namespace, key and workspace the helper owns.
 */

const WS = "ws-ports";
const clock = { nowIso: () => "2026-11-23T00:00:00.000Z", nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") };
const ids = { newId: () => "ports-id" };
const principals = { findActiveById: async () => null };

/** A registrar spy recording each call's deps, namespace and definition keys. */
function registrar() {
  const calls: Array<{ deps: unknown; namespace: string; keys: string[] }> = [];
  const ensure = (async (deps, input) => {
    calls.push({ deps, namespace: input.namespace, keys: input.definitions.map((definition) => definition.key) });
  }) as typeof ensureSettingDefinitions;
  const deps = { settingsRepo: new InMemorySettingsRepo(), clock, ids, principals, ensureSettingDefinitions: ensure };
  return { calls, deps };
}

/** A reader spy answering from `values` by key and recording each read. */
function reader(values: Record<string, unknown>) {
  const reads: Array<[string, string, unknown]> = [];
  const read: typeof getEffective = async (input) => {
    reads.push([input.namespace, input.key, input.scopeContext]);
    return input.key in values ? ({ value: values[input.key] } as Awaited<ReturnType<typeof getEffective>>) : null;
  };
  return { reads, read };
}

test("admin-interface registers both namespaces through the injected registrar, passing the same deps", async () => {
  const { calls, deps } = registrar();
  await ensureAdminInterfaceSettingDefinitions(deps, { systemPrincipalId: "system" });
  assert.deepEqual(calls.map((call) => [call.deps, call.namespace, call.keys.length]), [[deps, ADMIN_INTERFACE_NAMESPACE, 11], [deps, "core.appearance", 1]]);
});

test("chart-provider registers core.charts/provider through the injected registrar", async () => {
  const { calls, deps } = registrar();
  await ensureChartProviderSetting({ deps, systemPrincipalId: "system" });
  assert.deepEqual(calls, [{ deps, namespace: "core.charts", keys: ["provider"] }]);
});

test("form-delivery registers through the injected registrar and reads through the injected reader", async () => {
  const { calls, deps } = registrar();
  await ensureFormDeliverySettings({ deps, systemPrincipalId: "system" });
  assert.deepEqual(calls, [{ deps, namespace: "core.forms", keys: ["deliveryBindings", "autoPull"] }]);
  const { reads, read } = reader({ autoPull: false, deliveryBindings: [] });
  assert.equal(await readFormsAutoPull({ settingsRepo: new InMemorySettingsRepo(), workspaceId: WS, getEffective: read }), false);
  assert.deepEqual(await readFormDeliveryBindings({ settingsRepo: new InMemorySettingsRepo(), workspaceId: WS, getEffective: read }), []);
  assert.deepEqual(reads, [["core.forms", "autoPull", { workspaceId: WS }], ["core.forms", "deliveryBindings", { workspaceId: WS }]]);
});

test("form-destination registers and reads core.forms/receiver through the injected collaborators", async () => {
  const { calls, deps } = registrar();
  await ensureFormDestinationSetting({ deps, systemPrincipalId: "system" });
  assert.deepEqual(calls, [{ deps, namespace: "core.forms", keys: ["receiver"] }]);
  const { reads, read } = reader({ receiver: "netlify" });
  assert.equal(await readFormDestinationSetting({ settingsRepo: new InMemorySettingsRepo(), workspaceId: WS, getEffective: read }), "netlify");
  assert.deepEqual(reads, [["core.forms", "receiver", { workspaceId: WS }]]);
});

test("mail-sender registers and reads both sender keys through the injected collaborators", async () => {
  const { calls, deps } = registrar();
  await ensureMailSenderSettings({ deps, systemPrincipalId: "system" });
  assert.deepEqual(calls, [{ deps, namespace: MAIL_SENDER_NAMESPACE, keys: [MAIL_SENDER_EMAIL_KEY, MAIL_SENDER_NAME_KEY] }]);
  const { reads, read } = reader({ [MAIL_SENDER_EMAIL_KEY]: " hello@example.com ", [MAIL_SENDER_NAME_KEY]: "Example" });
  assert.deepEqual(await readMailSenderSetting({ settingsRepo: new InMemorySettingsRepo(), workspaceId: WS, getEffective: read }), { email: "hello@example.com", name: "Example" });
  assert.deepEqual(reads, [[MAIL_SENDER_NAMESPACE, MAIL_SENDER_EMAIL_KEY, { workspaceId: WS }], [MAIL_SENDER_NAMESPACE, MAIL_SENDER_NAME_KEY, { workspaceId: WS }]]);
});

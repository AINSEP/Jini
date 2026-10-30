import { describe, expect, test } from "vitest";

import type { PaymentProvider } from "../../contract/provider.js";
import { createKernelProviderRegistry } from "../../provider-registry.js";
import { createLipayFake } from "../../testkit/lipay-fake.js";

/** @file The kernel provider registry: ids bound to the plugin that contributed them, duplicates and bad ids refused at boot. */

const lipay = createLipayFake({ now: () => 0 }).provider;
const as = (id: string): PaymentProvider => ({ ...lipay, id });

describe("createKernelProviderRegistry", () => {
  test("looks providers up by id with their plugin, lists them in load order, and answers null for an unknown id", () => {
    const registry = createKernelProviderRegistry({ items: [{ pluginId: "p-lipay", module: lipay }, { pluginId: "p-stripe", module: as("stripe") }] });
    expect(registry.get({ id: "lipay" })).toEqual({ provider: lipay, pluginId: "p-lipay" });
    expect(registry.get({ id: "paypal" })).toBeNull();
    expect(registry.list().map((r) => [r.provider.id, r.pluginId])).toEqual([["lipay", "p-lipay"], ["stripe", "p-stripe"]]);
  });

  test("an empty registry lists nothing", () => {
    expect(createKernelProviderRegistry({ items: [] }).list()).toEqual([]);
  });

  test("listing providers returns a detached list that callers cannot empty out of the registry", () => {
    const registry = createKernelProviderRegistry({ items: [{ pluginId: "p-lipay", module: lipay }] });
    const listed = registry.list();
    (listed as unknown[]).length = 0;
    expect(registry.list()).toEqual([{ provider: lipay, pluginId: "p-lipay" }]);
    expect(registry.get({ id: "lipay" })).toEqual({ provider: lipay, pluginId: "p-lipay" });
  });

  test("a valid constructor provider id does not inherit an undeclared host binding", () => {
    const provider = as("constructor");
    // Regression: registrationProblem reads bindings[id] on {}, inheriting Object's constructor
    // and refusing this otherwise valid URL-safe id as if the host had pinned it to another plugin.
    const registry = createKernelProviderRegistry({ items: [{ pluginId: "p-constructor", module: provider }] });
    expect(registry.get({ id: "constructor" })).toEqual({ provider, pluginId: "p-constructor" });
    expect(registry.list()).toEqual([{ provider, pluginId: "p-constructor" }]);
  });

  test("a second plugin claiming an id is refused, naming both plugins", () => {
    expect(() => createKernelProviderRegistry({ items: [{ pluginId: "real", module: lipay }, { pluginId: "evil", module: lipay }] }))
      .toThrow("commerce: payment provider 'lipay' from 'evil' is already registered by 'real'");
  });

  test.each(["Stripe", "pay pal", "a--b", "-x", "", "x/../y"])("an id that is not a URL-safe path segment (%j) is refused", (id) => {
    expect(() => createKernelProviderRegistry({ items: [{ pluginId: "p", module: as(id) }] })).toThrow(/^commerce: invalid payment provider id/);
  });

  test("host bindings pin an id to one plugin; other ids are unaffected", () => {
    const bindings = { lipay: "p-lipay" };
    expect(createKernelProviderRegistry({ items: [{ pluginId: "p-lipay", module: lipay }, { pluginId: "x", module: as("stripe-2") }] }, { bindings }).list()).toHaveLength(2);
    expect(() => createKernelProviderRegistry({ items: [{ pluginId: "impostor", module: lipay }] }, { bindings }))
      .toThrow("commerce: payment provider 'lipay' is bound to plugin 'p-lipay', not 'impostor'");
  });
});

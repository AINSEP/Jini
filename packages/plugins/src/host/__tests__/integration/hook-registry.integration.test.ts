import assert from "node:assert/strict";
import { test } from "vitest";

import { createHookRegistry, PluginHookFailedError } from "../support/hook-registry.js";
import type { ContentEntryDraft } from "../support/fixture-sdk.js";

/**
 * @file C-010 `createHookRegistry()`/`runBeforeSave()` — SPEC-005 REQ-05/REQ-06, BR-04/BR-06/BR-07,
 * TB-01, AC-01/AC-05/AC-06/AC-07, EC-06/EC-10. **CIC U-004 (Binding, no escalation marker):
 * hook-then-single-write fail-closed atomicity.** This is the dedicated, direct coverage the TDD
 * dispatch requires for U-004 — a throwing/denied/invalid filter must reject `runBeforeSave()`
 * entirely (no partial merged patch returned), so `post.ts`'s single `repo.save()` call is never
 * reached on that path.
 *
 * TDD-certified against the stub in `../../hook-registry.ts`; currently RED — `createHookRegistry`
 * throws "not implemented". These assertions describe the contract the Programmer stage must
 * satisfy.
 */

function draft(overrides: Partial<ContentEntryDraft> = {}): ContentEntryDraft {
  return {
    id: "entry-1",
    workspaceId: "ws-1",
    title: "Hello",
    slug: "hello",
    status: "draft",
    bodyJson: { type: "doc", content: [] },
    ext: {},
    ...overrides,
  };
}

test("AC-01/BR-04: a single attached plugin's returned patch is merged into ext.{pluginId}", async () => {
  const registry = createHookRegistry();
  registry.attach("word-count", "built-in", async () => ({ count: 5 }), [
    { path: "ext.word-count.count", type: "integer" },
  ]);

  const result = await registry.runBeforeSave(draft());
  assert.deepEqual(result, { "word-count": { count: 5 } });
});

test("TB-01: composition runs built-ins first (id ascending), then site plugins (id ascending), regardless of attach order", async () => {
  const registry = createHookRegistry();
  const callOrder: string[] = [];

  const makeFilter = (id: string) => async () => {
    callOrder.push(id);
    return { marker: id };
  };

  // Attach in a deliberately scrambled order.
  registry.attach("zeta-site", "site", makeFilter("zeta-site"), [{ path: "ext.zeta-site.marker", type: "string" }]);
  registry.attach("z-built-in", "built-in", makeFilter("z-built-in"), [{ path: "ext.z-built-in.marker", type: "string" }]);
  registry.attach("alpha-site", "site", makeFilter("alpha-site"), [{ path: "ext.alpha-site.marker", type: "string" }]);
  registry.attach("a-built-in", "built-in", makeFilter("a-built-in"), [{ path: "ext.a-built-in.marker", type: "string" }]);

  await registry.runBeforeSave(draft());

  assert.deepEqual(callOrder, ["a-built-in", "z-built-in", "alpha-site", "zeta-site"]);
});

test("BR-04/EC-07: a detached (disabled) plugin's filter does not run and contributes nothing", async () => {
  const registry = createHookRegistry();
  let calls = 0;
  registry.attach("word-count", "built-in", async () => {
    calls += 1;
    return { count: 5 };
  }, [{ path: "ext.word-count.count", type: "integer" }]);

  registry.detach("word-count");
  const result = await registry.runBeforeSave(draft());

  assert.equal(calls, 0);
  assert.deepEqual(result, {});
});

test("behavior.spec.md §10: zero attached plugins is a no-op — runBeforeSave resolves to an empty patch", async () => {
  const registry = createHookRegistry();
  const result = await registry.runBeforeSave(draft());
  assert.deepEqual(result, {});
});

test("CIC U-004-B1/F1 (BR-07/EC-10, fail-closed): a filter that throws rejects runBeforeSave entirely — no partial patch is ever returned", async () => {
  const registry = createHookRegistry();
  registry.attach(
    "good-plugin",
    "site",
    async () => ({ ok: true } as never),
    [{ path: "ext.good-plugin.ok", type: "boolean" }]
  );
  registry.attach(
    "throwing-plugin",
    "site",
    async () => {
      throw new Error("boom");
    },
    []
  );

  const input = draft({ ext: { existing: { keep: "original" } } });
  const original = structuredClone(input);
  await assert.rejects(() => registry.runBeforeSave(input), { name: "PluginHookFailedError", pluginId: "throwing-plugin", message: "plugin 'throwing-plugin' content.entry.beforeSave filter failed: boom" });
  assert.deepEqual(input, original, "an earlier successful filter must not leak into the rejected draft");
});

test("EC-06 (CAPABILITY_DENIED inside a filter is fail-closed the same as a plain throw)", async () => {
  const registry = createHookRegistry();
  registry.attach(
    "denied-plugin",
    "site",
    async () => {
      const err = new Error("capability denied") as Error & { name: string };
      err.name = "CapabilityDeniedError";
      throw err;
    },
    []
  );

  await assert.rejects(() => registry.runBeforeSave(draft()), { name: "PluginHookFailedError", pluginId: "denied-plugin", message: "plugin 'denied-plugin' content.entry.beforeSave filter failed: capability denied" });
});

test("BR-06/AC-07: a filter returning a value for a field it did NOT declare rejects with FIELD_PATH_INVALID semantics (fail-closed)", async () => {
  const registry = createHookRegistry();
  registry.attach(
    "sneaky-plugin",
    "site",
    async () => ({ undeclaredField: "not declared in manifest.fields" }),
    [{ path: "ext.sneaky-plugin.declaredField", type: "string" }] // does NOT include undeclaredField
  );

  await assert.rejects(() => registry.runBeforeSave(draft()), { name: "PluginHookFailedError", pluginId: "sneaky-plugin", message: "plugin 'sneaky-plugin' returned undeclared ext field 'undeclaredField' (FIELD_PATH_INVALID)" });
});

test("BR-06/AC-07: a filter returning a value whose type does not match its declared field type rejects (FIELD_TYPE_MISMATCH, fail-closed)", async () => {
  const registry = createHookRegistry();
  registry.attach(
    "type-mismatch-plugin",
    "site",
    async () => ({ count: "not-a-number" as never }),
    [{ path: "ext.type-mismatch-plugin.count", type: "integer" }]
  );

  await assert.rejects(() => registry.runBeforeSave(draft()), { name: "PluginHookFailedError", pluginId: "type-mismatch-plugin", message: "plugin 'type-mismatch-plugin' returned ext field 'count' with a value not matching its declared type 'integer' (FIELD_TYPE_MISMATCH)" });
});

test("REQ-05/RT-001: the filter receives the entry read-only and cannot mutate core fields via its return value — a returned 'slug'/'status'/'title'/'bodyJson' key is rejected, not silently merged into ext", async () => {
  const registry = createHookRegistry();
  registry.attach(
    "core-field-attacker",
    "site",
    async () => ({ slug: "hijacked" } as never),
    [] // no declared fields at all — 'slug' is not a declared ext field, and is also a core field name
  );

  await assert.rejects(() => registry.runBeforeSave(draft()), { name: "PluginHookFailedError", pluginId: "core-field-attacker", message: "plugin 'core-field-attacker' returned undeclared ext field 'slug' (FIELD_PATH_INVALID)" });
});

test("ADR-024 §3: a synchronous (non-async) filter function is honored exactly like an async one — core always awaits", async () => {
  const registry = createHookRegistry();
  registry.attach("sync-plugin", "site", (() => ({ count: 1 })) as never, [
    { path: "ext.sync-plugin.count", type: "integer" },
  ]);

  const result = await registry.runBeforeSave(draft());
  assert.deepEqual(result, { "sync-plugin": { count: 1 } });
});

// --- ADR-057 Decision 3: the additive third TB-01 rank ("glue", after "built-in" and "site"). ---
// Added 2026-08-04 alongside Site Glue's content-lifecycle attachment point; every test above this
// point is the pre-existing, unmodified SPEC-005 certified suite.

test("ADR-057 Decision 3: a 'glue'-sourced attachment composes AFTER built-in and site, id-ascending among themselves, regardless of attach order", async () => {
  const registry = createHookRegistry();
  const callOrder: string[] = [];

  const makeFilter = (id: string) => async () => {
    callOrder.push(id);
    return { marker: id };
  };

  // Attach in a deliberately scrambled order, across all three ranks.
  registry.attach("zeta-glue", "glue", makeFilter("zeta-glue"), [{ path: "ext.zeta-glue.marker", type: "string" }]);
  registry.attach("zeta-site", "site", makeFilter("zeta-site"), [{ path: "ext.zeta-site.marker", type: "string" }]);
  registry.attach("z-built-in", "built-in", makeFilter("z-built-in"), [{ path: "ext.z-built-in.marker", type: "string" }]);
  registry.attach("alpha-glue", "glue", makeFilter("alpha-glue"), [{ path: "ext.alpha-glue.marker", type: "string" }]);
  registry.attach("alpha-site", "site", makeFilter("alpha-site"), [{ path: "ext.alpha-site.marker", type: "string" }]);
  registry.attach("a-built-in", "built-in", makeFilter("a-built-in"), [{ path: "ext.a-built-in.marker", type: "string" }]);

  await registry.runBeforeSave(draft());

  assert.deepEqual(callOrder, [
    "a-built-in",
    "z-built-in",
    "alpha-site",
    "zeta-site",
    "alpha-glue",
    "zeta-glue",
  ]);
});

test("ADR-057 Decision 3: a glue-sourced filter's returned patch merges into ext.{moduleId} exactly like a built-in/site plugin's", async () => {
  const registry = createHookRegistry();
  registry.attach("site-glue-example", "glue", async () => ({ count: 7 }), [
    { path: "ext.site-glue-example.count", type: "integer" },
  ]);

  const result = await registry.runBeforeSave(draft());
  assert.deepEqual(result, { "site-glue-example": { count: 7 } });
});

test("BR-04: a later-composed plugin's filter observes the earlier plugin's already-merged ext on the entry snapshot it receives", async () => {
  const registry = createHookRegistry();
  let secondFilterSawFirstPluginsExt: unknown;

  registry.attach("a-built-in", "built-in", async () => ({ value: 1 }), [
    { path: "ext.a-built-in.value", type: "integer" },
  ]);
  registry.attach(
    "b-site",
    "site",
    async (entry) => {
      secondFilterSawFirstPluginsExt = entry.ext["a-built-in"];
      return { value: 2 };
    },
    [{ path: "ext.b-site.value", type: "integer" }]
  );

  await registry.runBeforeSave(draft());
  assert.deepEqual(secondFilterSawFirstPluginsExt, { value: 1 });
});

test("ADR-024 §3: each filter receives a deeply isolated snapshot", async () => {
  const registry = createHookRegistry();
  const input = draft({
    bodyJson: { type: "doc", content: [{ text: "original" }] },
    ext: { existing: { nested: { value: "original" }, items: ["original"] } },
  });
  let secondSnapshot: ContentEntryDraft | undefined;

  registry.attach(
    "a-mutator",
    "site",
    async (entry) => {
      // Deliberately ignores the draft's readonly typing: the point is a filter that mutates anyway.
      const body = entry.bodyJson as { content: Array<{ text: string }> };
      const existing = entry.ext.existing as { nested: { value: string }; items: string[] };
      body.content[0]!.text = "mutated";
      existing.nested.value = "mutated";
      existing.items.push("mutated");
      return {};
    },
    []
  );
  registry.attach(
    "b-observer",
    "site",
    async (entry) => {
      secondSnapshot = entry;
      return {};
    },
    []
  );

  await registry.runBeforeSave(input);

  assert.deepEqual(input.bodyJson, { type: "doc", content: [{ text: "original" }] });
  assert.deepEqual(input.ext.existing, {
    nested: { value: "original" },
    items: ["original"],
  });
  assert.deepEqual(secondSnapshot?.bodyJson, { type: "doc", content: [{ text: "original" }] });
  assert.deepEqual(secondSnapshot?.ext.existing, {
    nested: { value: "original" },
    items: ["original"],
  });
});

test("auto-quarantine: the injected consecutive-failure threshold detaches the filter immediately and reports the durable-state event", async () => {
  const quarantines: Array<{
    pluginId: string;
    workspaceId: string;
    consecutiveFailures: number;
    reason: string;
  }> = [];
  const registry = createHookRegistry({
    failureThreshold: 2,
    onQuarantine: async (event: (typeof quarantines)[number]) => {
      quarantines.push(event);
    },
  });
  registry.attach("thrower", "site", async () => {
    throw new Error("deterministic boom");
  }, []);

  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 0, "one failure is below the injected threshold");

  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 1);
  assert.deepEqual(quarantines[0], {
    pluginId: "thrower",
    workspaceId: "ws-1",
    consecutiveFailures: 2,
    reason: "plugin 'thrower' content.entry.beforeSave filter failed: deterministic boom",
  });

  assert.deepEqual(
    await registry.runBeforeSave(draft()),
    {},
    "the thresholding save still fails closed, but the next save recovers because the filter is detached"
  );
});

test("auto-quarantine: the default policy quarantines on the third consecutive failure", async () => {
  const quarantines: unknown[] = [];
  const registry = createHookRegistry({
    onQuarantine: async (event) => {
      quarantines.push(event);
    },
  });
  registry.attach("default-threshold", "site", async () => {
    throw new Error("boom");
  }, []);

  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 0);
  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 1);
});

test("auto-quarantine: a successful invocation resets the consecutive-failure counter", async () => {
  const quarantines: unknown[] = [];
  const outcomes: Array<"fail" | "success"> = ["fail", "success", "fail", "fail"];
  const registry = createHookRegistry({
    failureThreshold: 2,
    onQuarantine: async (event: unknown) => {
      quarantines.push(event);
    },
  });
  registry.attach("flaky", "site", async () => {
    const outcome = outcomes.shift();
    if (outcome === "fail") throw new Error("flaky boom");
    return { ok: true };
  }, [{ path: "ext.flaky.ok", type: "boolean" }]);

  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.deepEqual(await registry.runBeforeSave(draft()), { flaky: { ok: true } });
  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 0, "the failure after a success must restart at one");
  await assert.rejects(() => registry.runBeforeSave(draft()), PluginHookFailedError);
  assert.equal(quarantines.length, 1);
});

test("auto-quarantine: counters are scoped by workspace as well as plugin", async () => {
  const quarantines: Array<{ workspaceId: string }> = [];
  const registry = createHookRegistry({
    failureThreshold: 2,
    onQuarantine: async (event: { workspaceId: string }) => {
      quarantines.push(event);
    },
  });
  registry.attach("thrower", "site", async () => {
    throw new Error("boom");
  }, []);

  await assert.rejects(() => registry.runBeforeSave(draft({ workspaceId: "ws-a" })), PluginHookFailedError);
  await assert.rejects(() => registry.runBeforeSave(draft({ workspaceId: "ws-b" })), PluginHookFailedError);
  assert.equal(quarantines.length, 0, "one failure in each workspace is not two consecutive failures in either workspace");

  await assert.rejects(() => registry.runBeforeSave(draft({ workspaceId: "ws-a" })), PluginHookFailedError);
  assert.deepEqual(quarantines.map((event) => event.workspaceId), ["ws-a"]);
});

// F4.4: a declared ext field may share a core name, but remains inside the plugin namespace.
test("a declared ext slug does not change the entry's core slug", async () => {
  const registry = createHookRegistry();
  registry.attach("p", "site", async () => ({ slug: "plugin-slug" }), [{ path: "ext.p.slug", type: "string" }]);
  const input = draft();
  assert.deepEqual(await registry.runBeforeSave(input), { p: { slug: "plugin-slug" } });
  assert.equal(input.slug, "hello");
  assert.deepEqual(input.ext, {});
});

for (const patch of [null, 42, "text", []]) {
  test(`malformed patch ${JSON.stringify(patch)} fails closed`, async () => {
    const registry = createHookRegistry();
    registry.attach("malformed", "site", async () => patch as never, []);
    await assert.rejects(() => registry.runBeforeSave(draft()), {
      name: "PluginHookFailedError", pluginId: "malformed",
      message: "plugin 'malformed' returned a non-object ext patch from its beforeSave filter",
    });
  });
}

test("failed quarantine persistence preserves the failure and detaches the filter for the next save", async () => {
  const persistenceError = new Error("activation store unavailable");
  let calls = 0;
  const events: unknown[] = [];
  const registry = createHookRegistry({ failureThreshold: 1, onQuarantine: async (event) => { events.push(event); throw persistenceError; } });
  registry.attach("bad", "site", async () => { calls++; throw new Error("filter exploded"); }, []);
  await assert.rejects(() => registry.runBeforeSave(draft()), (error: unknown) => {
    assert.ok(error instanceof PluginHookFailedError);
    assert.equal(error.pluginId, "bad");
    assert.equal(error.message, "plugin 'bad' content.entry.beforeSave filter failed: filter exploded; automatic quarantine persistence failed: activation store unavailable");
    assert.equal(error.cause, persistenceError);
    return true;
  });
  assert.deepEqual(events, [{ pluginId: "bad", workspaceId: "ws-1", consecutiveFailures: 1, reason: "plugin 'bad' content.entry.beforeSave filter failed: filter exploded" }]);
  assert.deepEqual(await registry.runBeforeSave(draft()), {});
  assert.equal(calls, 1);
});

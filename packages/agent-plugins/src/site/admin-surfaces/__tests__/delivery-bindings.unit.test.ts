/**
 * @file Unit tests for `delivery-bindings.ts`, the host's `deliveryBindings` port: what a plugin's
 * surface sees (its own adapters' bindings, connection ids instead of refs, form slugs instead of
 * row ids), the refusals (no admin, an adapter the plugin does not contribute, a connection it does
 * not declare, an unknown form, another plugin's binding), ownership re-read inside the write, and
 * the binding owner's validation refusal kept people-facing. Typed fakes; no provider names.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { AdminSurfaceActionError, type AdminSurfaceDeliveryBindingDraft } from "../../../admin-surfaces/index.js";
import type { FormDeliveryBinding } from "@jini-ai/core/contracts/site/cms-forms";
import { ValueValidationFailedError } from "@jini-ai/core/settings";

import { createSurfaceDeliveryBindings, type FormDeliveryBindingsStore } from "../delivery-bindings.js";

/** The host's injected connection-ref deriver and binding-owner conflict error, as typed fakes. */
const deriveApiConnectionKey = ({ workspaceId, pluginId, connectionId }: { readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string }) => `connection:${workspaceId}:${pluginId}:${connectionId}`;
class FormDeliveryBindingsConflictError extends Error {}

const WORKSPACE = "ws-1";
const PLUGIN = "acme-office";
const ADAPTER = "acme-office-rows";
const REF = deriveApiConnectionKey({ workspaceId: WORKSPACE, pluginId: PLUGIN, connectionId: "account" });
const FOREIGN_REF = deriveApiConnectionKey({ workspaceId: WORKSPACE, pluginId: "other-plugin", connectionId: "account" });

const own = (bindingId: string, extra: Partial<FormDeliveryBinding> = {}): FormDeliveryBinding => ({ bindingId, adapterId: ADAPTER, connectionRef: REF, enabled: true, config: { table: bindingId }, ...extra });
type DraftExtra = Partial<Pick<AdminSurfaceDeliveryBindingDraft, "bindingId" | "adapterId" | "connectionId" | "enabled">> & { readonly formIds?: readonly string[] };
/** A draft stating its forms, as Jini now requires: the given `formIds`, else `allForms: true`. */
const draft = (extra: DraftExtra = {}): AdminSurfaceDeliveryBindingDraft => {
  const { formIds, ...rest } = extra;
  return { adapterId: ADAPTER, connectionId: "account", enabled: true, config: { table: "Leads" }, ...rest, ...(formIds === undefined ? { allForms: true as const } : { formIds }) };
};

/** An in-memory binding owner; `onRead` lets a test change the list between reads (another writer). */
function store(initial: readonly FormDeliveryBinding[], optional: { failWrite?: Error; onRead?: (reads: number) => readonly FormDeliveryBinding[] | undefined } = {}) {
  let value: readonly FormDeliveryBinding[] = initial;
  let reads = 0;
  const writes: { workspaceId: string; callerPrincipalId: string; value: readonly FormDeliveryBinding[] }[] = [];
  const port: FormDeliveryBindingsStore = {
    isConflict: ({ error }) => error instanceof FormDeliveryBindingsConflictError,
    async read() { reads += 1; value = optional.onRead?.(reads) ?? value; return structuredClone(value); },
    async write({ expectedValue, ...input }) {
      if (optional.failWrite) throw optional.failWrite;
      if (JSON.stringify(expectedValue) !== JSON.stringify(value)) throw new FormDeliveryBindingsConflictError();
      writes.push(input); value = input.value;
    },
  };
  return { port, writes, current: () => value };
}

function portFor(bindings: ReturnType<typeof store>, optional: { principalId?: string | undefined; workspaceId?: string } = {}) {
  let next = 0;
  return createSurfaceDeliveryBindings({
    pluginId: PLUGIN, workspaceId: optional.workspaceId ?? WORKSPACE, ...("principalId" in optional ? (optional.principalId === undefined ? {} : { principalId: optional.principalId }) : { principalId: "admin-1" }),
    siteWorkspaceId: WORKSPACE,
    declaredConnectionIds: async ({ pluginId }) => (pluginId === PLUGIN ? ["account"] : []),
    contributedAdapterIds: async ({ pluginId }) => (pluginId === PLUGIN ? [ADAPTER] : []),
    forms: { list: async () => [{ id: "form-1", slug: "contact" }, { id: "form-2", slug: "signup" }] },
    bindings: bindings.port, newBindingId: () => `new-${(next += 1)}`, deriveConnectionRef: deriveApiConnectionKey,
  });
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  const error = await promise.then(() => assert.fail("expected a refusal"), (caught: unknown) => caught);
  assert.ok(error instanceof AdminSurfaceActionError, `expected an AdminSurfaceActionError, got ${String(error)}`);
  return { code: error.code, message: error.message };
}

// --- list ----------------------------------------------------------------------------------------

test("list (F11): own bindings with the connection id (never the ref) and form slugs; a stored binding without formIds is listed as allForms: true", async () => {
  const bindings = store([own("b1", { formIds: ["form-1", "form-2"] }), own("b2")]);
  assert.deepEqual(await portFor(bindings).list(), [
    { bindingId: "b1", adapterId: ADAPTER, connectionId: "account", enabled: true, formIds: ["contact", "signup"], config: { table: "b1" } },
    { bindingId: "b2", adapterId: ADAPTER, connectionId: "account", enabled: true, allForms: true, config: { table: "b2" } },
  ]);
});

test("list: a form id whose form is gone is left out of the slugs", async () => {
  const bindings = store([own("b1", { formIds: ["form-1", "form-deleted"] })]);
  assert.deepEqual((await portFor(bindings).list())[0]?.formIds, ["contact"]);
});

test("T7: re-saving a binding preserves its temporarily hidden trashed form ids", async () => {
  // The forms repository omits trashed forms from list(), but their stored bindings must survive.
  const bindings = store([own("b1", { formIds: ["form-1", "form-trashed"] })]);
  const port = portFor(bindings);
  const [listed] = await port.list();
  assert.ok(listed);
  assert.deepEqual(listed.formIds, ["contact"]);

  await port.save({ ...listed, enabled: false });

  assert.equal(bindings.current()[0]!.enabled, false);
  assert.deepEqual(bindings.current()[0]!.formIds, ["form-1", "form-trashed"]);
});

test("security: list leaves out another adapter's binding and a binding on another plugin's connection", async () => {
  const bindings = store([own("b1"), own("x1", { adapterId: "other-rows" }), own("x2", { connectionRef: FOREIGN_REF })]);
  assert.deepEqual((await portFor(bindings).list()).map((binding) => binding.bindingId), ["b1"]);
});

test("security: a scope in another workspace owns nothing and reads no binding", async () => {
  const bindings = store([own("b1")], { onRead: () => assert.fail("another workspace's bindings were read") });
  assert.deepEqual(await portFor(bindings, { workspaceId: "ws-other" }).list(), []);
});

test("security: list without a signed-in admin is refused (admin-required)", async () => {
  assert.equal((await refusal(portFor(store([own("b1")]), { principalId: undefined }).list())).code, "admin-required");
});

// --- save ----------------------------------------------------------------------------------------

test("save: a new binding gets a host id, the plugin's own ref and form row ids, is appended, and is written as the admin", async () => {
  const bindings = store([own("b1")]);
  const saved = await portFor(bindings).save(draft({ formIds: ["signup"] }));
  assert.deepEqual(saved, { bindingId: "new-1", adapterId: ADAPTER, connectionId: "account", enabled: true, formIds: ["signup"], config: { table: "Leads" } });
  assert.deepEqual(bindings.writes, [{ workspaceId: WORKSPACE, callerPrincipalId: "admin-1", value: [own("b1"), { bindingId: "new-1", adapterId: ADAPTER, connectionRef: REF, enabled: true, formIds: ["form-2"], config: { table: "Leads" } }] }]);
});

test("save: an existing own binding is replaced in place, the others kept in order", async () => {
  const bindings = store([own("b1"), own("x1", { adapterId: "other-rows" }), own("b2")]);
  await portFor(bindings).save(draft({ bindingId: "b1", enabled: false }));
  assert.deepEqual(bindings.current().map((binding) => [binding.bindingId, binding.enabled]), [["b1", false], ["x1", true], ["b2", true]]);
});

test("save (F11): an allForms draft stores no formIds (the forms build's every form) and is answered as allForms: true", async () => {
  const bindings = store([]);
  const saved = await portFor(bindings).save(draft());
  assert.equal(Object.hasOwn(bindings.current()[0]!, "formIds"), false);
  assert.deepEqual({ allForms: saved.allForms, formIds: saved.formIds }, { allForms: true, formIds: undefined });
});

test("save (F11): a draft naming no forms (formIds: []) stores an empty list, never every form", async () => {
  const bindings = store([]);
  const saved = await portFor(bindings).save(draft({ formIds: [] }));
  assert.deepEqual(bindings.current()[0]!.formIds, []);
  assert.deepEqual(saved.formIds, []);
});

test("security: saving an adapter the plugin does not contribute is refused (adapter-not-owned); nothing written", async () => {
  const bindings = store([]);
  const { code, message } = await refusal(portFor(bindings).save(draft({ adapterId: "other-rows" })));
  assert.equal(code, "adapter-not-owned");
  assert.match(message, /"other-rows"/);
  assert.deepEqual(bindings.writes, []);
});

test("security: saving with a connection the plugin does not declare is refused (connection-not-declared); nothing written", async () => {
  const bindings = store([]);
  assert.equal((await refusal(portFor(bindings).save(draft({ connectionId: "other" })))).code, "connection-not-declared");
  assert.deepEqual(bindings.writes, []);
});

test("save: a form slug this site does not have is refused (form-not-found); nothing written", async () => {
  const bindings = store([]);
  const { code, message } = await refusal(portFor(bindings).save(draft({ formIds: ["contact", "missing"] })));
  assert.equal(code, "form-not-found");
  assert.match(message, /"missing"/);
  assert.deepEqual(bindings.writes, []);
});

test("security: overwriting another adapter's binding by id is refused (binding-not-found); nothing written", async () => {
  const bindings = store([own("x1", { adapterId: "other-rows" })]);
  assert.equal((await refusal(portFor(bindings).save(draft({ bindingId: "x1" })))).code, "binding-not-found");
  assert.deepEqual(bindings.writes, []);
});

test("security: ownership is re-read inside the write: a binding that changed adapter after the list is not overwritten", async () => {
  // Read 1 is the session's list (own); read 2, inside save, sees another writer moved it to another adapter.
  const bindings = store([own("b1")], { onRead: (reads) => (reads === 2 ? [own("b1", { adapterId: "other-rows" })] : undefined) });
  const port = portFor(bindings);
  assert.deepEqual((await port.list()).map((binding) => binding.bindingId), ["b1"]);
  assert.equal((await refusal(port.save(draft({ bindingId: "b1" })))).code, "binding-not-found");
  assert.deepEqual(bindings.writes, []);
});

test("security: save without a signed-in admin is refused (admin-required); nothing read or written", async () => {
  const bindings = store([], { onRead: () => assert.fail("read without an admin") });
  assert.equal((await refusal(portFor(bindings, { principalId: undefined }).save(draft()))).code, "admin-required");
  assert.deepEqual(bindings.writes, []);
});

test("save: the binding owner's validation refusal becomes delivery-binding-invalid with its message and cause", async () => {
  const cause = new ValueValidationFailedError("Form delivery bindings (core.forms.deliveryBindings) has 101 bindings; at most 100 are allowed.");
  const error = await portFor(store([], { failWrite: cause })).save(draft()).catch((caught: unknown) => caught);
  assert.ok(error instanceof AdminSurfaceActionError);
  assert.deepEqual([error.code, error.message, error.cause], ["delivery-binding-invalid", cause.message, cause]);
});

test("save: any other write failure (authorization, ledger) propagates unchanged", async () => {
  const denied = new Error("settings.workspace.write denied");
  assert.equal(await portFor(store([], { failWrite: denied })).save(draft()).catch((caught: unknown) => caught), denied);
});

test("save: a second bindings conflict stops retrying and gives the panel an actionable refusal", async () => {
  let reads = 0;
  const bindings = store([], { failWrite: new FormDeliveryBindingsConflictError(), onRead: () => { reads += 1; return undefined; } });
  const error = await refusal(portFor(bindings).save(draft()));
  assert.equal(error.code, "delivery-binding-conflict");
  assert.match(error.message, /another panel.*List the bindings again/);
  assert.equal(reads, 2);
  assert.deepEqual(bindings.current(), []);
});

// --- remove --------------------------------------------------------------------------------------

test("remove: deletes only that own binding, written as the admin", async () => {
  const bindings = store([own("b1"), own("x1", { adapterId: "other-rows" }), own("b2")]);
  await portFor(bindings).remove({ bindingId: "b1" });
  assert.deepEqual(bindings.writes.map((write) => [write.callerPrincipalId, write.value.map((binding) => binding.bindingId)]), [["admin-1", ["x1", "b2"]]]);
});

test("security: removing another adapter's binding is refused (binding-not-found); nothing written", async () => {
  const bindings = store([own("x1", { adapterId: "other-rows" })]);
  assert.equal((await refusal(portFor(bindings).remove({ bindingId: "x1" }))).code, "binding-not-found");
  assert.deepEqual(bindings.writes, []);
});

test("security: remove without a signed-in admin is refused (admin-required); nothing written", async () => {
  const bindings = store([own("b1")]);
  assert.equal((await refusal(portFor(bindings, { principalId: undefined }).remove({ bindingId: "b1" }))).code, "admin-required");
  assert.deepEqual(bindings.writes, []);
});

test("a conflict on a create keeps the original generated id and the other writer's binding", async () => {
  const bindings = store([own("b1")], { onRead: reads => reads === 2 ? [own("b1"), own("foreign-write")] : undefined });
  const requestedIds: string[] = [];
  const ref = createSurfaceDeliveryBindings({
    pluginId: PLUGIN, workspaceId: WORKSPACE, siteWorkspaceId: WORKSPACE, principalId: "admin-1",
    declaredConnectionIds: async () => ["account"], contributedAdapterIds: async () => [ADAPTER],
    forms: { list: async () => [{ id: "form-1", slug: "contact" }] },
    bindings: {
      ...bindings.port,
      write: async input => {
        const id = input.value.find(row => row.bindingId.startsWith("new-"))?.bindingId;
        if (!id) throw new Error("draft did not reach the settings owner");
        requestedIds.push(id);
        if (requestedIds.length === 1) throw new FormDeliveryBindingsConflictError();
        return bindings.port.write(input);
      },
    },
    deriveConnectionRef: deriveApiConnectionKey,
    newBindingId: () => "new-" + (requestedIds.length + 1),
  });
  const saved = await ref.save(draft({ formIds: ["contact"] }));
  assert.equal(saved.bindingId, "new-1");
  assert.deepEqual(requestedIds, ["new-1", "new-1"]);
  assert.deepEqual(bindings.current().map(({ bindingId }) => bindingId), ["b1", "foreign-write", "new-1"]);
});

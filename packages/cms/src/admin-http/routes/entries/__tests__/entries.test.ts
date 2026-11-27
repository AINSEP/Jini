import { describe, expect, it } from "vitest";
import { registerContentType } from "../../../../content-types/index.js";
import { contentTypeWriteDeps } from "../../content-types/shared.js";
import { entryCreateRoute } from "../create.js";
import { entryLifecycleRoute } from "../lifecycle.js";
import { entryListRoute } from "../list.js";
import { entryUpdateRoute } from "../update.js";
import { makeDeps, MANAGE, PRINCIPAL, READ, RECIPE_FIELDS, recordingAuthorize, refusalOf } from "../../content-types/__tests__/helpers.js";

const ENTRY = { entityType: "entry" };
const raw = (body: unknown, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => ({ body, query, params });

/** Deps with an active `recipe` content type, so entry writes pass the parent-type check. */
async function seeded(options: { allowed?: boolean } = {}) {
  const made = makeDeps();
  const registered = await registerContentType({
    deps: contentTypeWriteDeps({ deps: made.deps }),
    input: { actorId: PRINCIPAL.id, workspaceId: made.deps.workspaceId, key: "recipe", label: "Recipe", fields: RECIPE_FIELDS as never },
  });
  if (!registered.ok) throw registered.error;
  if (options.allowed === false) made.deps.authorize = async () => ({ allowed: false, reason: "no_grant" });
  return made;
}

async function createSoup(deps: Awaited<ReturnType<typeof seeded>>["deps"]) {
  const { authorize } = recordingAuthorize();
  const result = await entryCreateRoute.handle({ input: { body: { type: "recipe", slug: "soup", title: "Soup" } }, deps, context: PRINCIPAL, authorize });
  if (!result.ok) throw new Error("expected success");
  return result.value;
}

describe("entryListRoute", () => {
  it("keeps the path, keeps only a string ?type= and lists after the read gate", async () => {
    expect([entryListRoute.method, entryListRoute.path]).toEqual(["get", "/api/admin/v1/entries"]);
    expect(entryListRoute.parse(raw(undefined, {}, { type: ["a"] }))).toEqual({ ok: true, value: { type: undefined } });
    const { deps } = await seeded();
    await createSoup(deps);
    const { authorize, calls } = recordingAuthorize();
    const result = await entryListRoute.handle({ input: { type: "recipe" }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...READ, ...ENTRY }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.items.map((item) => item.slug)).toEqual(["soup"]);
  });
});

describe("entryCreateRoute", () => {
  it("answers 201 with the entry, defaults fieldsJson and drains the outbox", async () => {
    expect([entryCreateRoute.method, entryCreateRoute.path, entryCreateRoute.successStatus]).toEqual(["post", "/api/admin/v1/entries", 201]);
    const { deps, events, drains } = await seeded();
    const { authorize, calls } = recordingAuthorize();
    const result = await entryCreateRoute.handle({ input: { body: { type: "recipe", slug: "soup", title: "Soup" } }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, ...ENTRY }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.entry.slug).toBe("soup");
    expect(result.value.entry.fieldsJson).toEqual({ ext: { site: {} } });
    expect(events.map((event) => event.name)).toContain("entry.created");
    expect(drains()).toBe(1);
  });

  it("refuses missing type/slug/title with 400 VALIDATION_ERROR", async () => {
    const { deps } = await seeded();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => entryCreateRoute.handle({ input: { body: { type: "recipe", slug: "soup" } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'type', 'slug', and 'title' (strings) are required", code: "VALIDATION_ERROR" },
    });
  });

  it("maps the write service's permission re-check to 403 FORBIDDEN without draining", async () => {
    const { deps, drains } = await seeded({ allowed: false });
    const { authorize } = recordingAuthorize();
    const refusal = await refusalOf(() => entryCreateRoute.handle({ input: { body: { type: "recipe", slug: "soup", title: "Soup" } }, deps, context: PRINCIPAL, authorize }));
    expect(refusal.status).toBe(403);
    expect((refusal.body as { code: string }).code).toBe("FORBIDDEN");
    expect(drains()).toBe(0);
  });
});

describe("entryUpdateRoute", () => {
  it("reads :id, forwards bodyJson only when present and drains", async () => {
    expect([entryUpdateRoute.method, entryUpdateRoute.path]).toEqual(["put", "/api/admin/v1/entries/:id"]);
    expect(entryUpdateRoute.parse(raw(undefined, { id: "e-1" }))).toEqual({ ok: true, value: { id: "e-1", body: {} } });
    const { deps, drains } = await seeded();
    const created = await createSoup(deps);
    const { authorize, calls } = recordingAuthorize();
    const result = await entryUpdateRoute.handle({ input: { id: created.entry.id, body: { expectedVersion: created.entry.version, title: "Stew" } }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, ...ENTRY }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.entry.title).toBe("Stew");
    expect(drains()).toBe(2);
  });

  it("refuses a missing expectedVersion (400) and maps a stale one to 409 VERSION_CONFLICT", async () => {
    const { deps } = await seeded();
    const created = await createSoup(deps);
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => entryUpdateRoute.handle({ input: { id: created.entry.id, body: {} }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'expectedVersion' (number) is required", code: "VALIDATION_ERROR" },
    });
    const stale = await refusalOf(() => entryUpdateRoute.handle({ input: { id: created.entry.id, body: { expectedVersion: 99, title: "x" } }, deps, context: PRINCIPAL, authorize }));
    expect([stale.status, (stale.body as { code: string }).code]).toEqual([409, "VERSION_CONFLICT"]);
  });
});

describe("entryLifecycleRoute", () => {
  it("publishes, then drains the outbox", async () => {
    expect([entryLifecycleRoute.method, entryLifecycleRoute.path]).toEqual(["post", "/api/admin/v1/entries/:id/lifecycle"]);
    const { deps, events } = await seeded();
    const created = await createSoup(deps);
    const { authorize } = recordingAuthorize();
    const result = await entryLifecycleRoute.handle({ input: { id: created.entry.id, body: { op: "publish", expectedVersion: created.entry.version } }, deps, context: PRINCIPAL, authorize });
    if (!result.ok) throw new Error("expected success");
    expect(result.value.entry.status).toBe("published");
    expect(events.map((event) => event.name)).toContain("entry.published");
  });

  it("refuses an unknown op with 400 VALIDATION_ERROR", async () => {
    const { deps } = await seeded();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => entryLifecycleRoute.handle({ input: { id: "e", body: { op: "explode", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'op' must be one of 'publish', 'unpublish'", code: "VALIDATION_ERROR" },
    });
  });

  it("rethrows an unmapped repo failure to the host error port", async () => {
    const { deps } = await seeded();
    deps.entryRepo.findById = async () => { throw new Error("db down"); };
    const { authorize } = recordingAuthorize();
    await expect(entryLifecycleRoute.handle({ input: { id: "e", body: { op: "publish", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
  });
});

it("lists only the requested collection from the parsed query", async () => {
  const { deps } = await seeded();
  const registration = await registerContentType({ deps: contentTypeWriteDeps({ deps }), input: {
    actorId: PRINCIPAL.id, workspaceId: deps.workspaceId, key: "article", label: "Article", fields: [
      { name: "title", kind: "text", required: false, queryable: false },
    ],
  } });
  if (!registration.ok) throw registration.error;
  await createSoup(deps);
  const { authorize } = recordingAuthorize();
  const create = await entryCreateRoute.handle({ input: { body: { type: "article", slug: "garden", title: "Garden" } }, deps, context: PRINCIPAL, authorize });
  if (!create.ok) throw new Error("could not create the second collection's entry");
  const parsed = await entryListRoute.parse(raw(undefined, {}, { type: "article" }));
  if (!parsed.ok) throw new Error("expected a parsed type filter");
  const result = await entryListRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize });
  if (!result.ok) throw new Error("expected a list response");
  expect(result.value.items.map(({ type, slug }) => [type, slug])).toEqual([["article", "garden"]]);
});

it("creates an entry from the HTTP body and stores explicit fields and document content", async () => {
  const { deps } = await seeded();
  const { authorize } = recordingAuthorize();
  const fieldsJson = { ext: { site: { title: "Broth" } } };
  const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
  const parsed = await entryCreateRoute.parse(raw({ type: "recipe", slug: "broth", title: "Broth", fieldsJson, bodyJson }));
  if (!parsed.ok) throw new Error("expected a parsed entry");
  const created = await entryCreateRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize });
  if (!created.ok) throw new Error("entry was not created");
  expect(created.value.entry).toMatchObject({ slug: "broth", fieldsJson: { ext: { site: { title: "Broth" } } }, bodyJson: { type: "doc", content: [{ type: "paragraph" }] } });
  expect(await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: created.value.entry.id })).toEqual(created.value.entry);
});

it.each(["type", "slug"] as const)("refuses a non-string entry %s without writing", async (key) => {
  const { deps, drains } = await seeded();
  const body = { type: "recipe", slug: "broth", title: "Broth", [key]: 7 };
  expect(await refusalOf(() => entryCreateRoute.handle({ input: { body }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toStrictEqual({
    status: 400, body: { error: "'type', 'slug', and 'title' (strings) are required", code: "VALIDATION_ERROR" },
  });
  expect(drains()).toBe(0);
});

it("a document-only update keeps the original title and persists the new body", async () => {
  const { deps } = await seeded();
  const { entry } = await createSoup(deps);
  const bodyJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bring to a boil" }] }] };
  const result = await entryUpdateRoute.handle({ input: { id: entry.id, body: { bodyJson, expectedVersion: entry.version } },
    deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
  expect(result).toMatchObject({ ok: true, value: { entry: { id: entry.id, version: entry.version + 1, title: "Soup", bodyJson } } });
  expect(await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: entry.id })).toMatchObject({ title: "Soup", bodyJson });
});

it("uses the parsed entry id to unpublish an existing published entry", async () => {
  const { deps, events, drains } = await seeded();
  const { entry } = await createSoup(deps);
  const { authorize } = recordingAuthorize();
  const published = await entryLifecycleRoute.handle({ input: { id: entry.id, body: { op: "publish", expectedVersion: entry.version } },
    deps, context: PRINCIPAL, authorize });
  if (!published.ok) throw new Error("could not publish entry");
  const parsed = await entryLifecycleRoute.parse(raw({ op: "unpublish", expectedVersion: published.value.entry.version }, { id: entry.id }));
  if (!parsed.ok) throw new Error("could not parse the transition");
  const result = await entryLifecycleRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize });
  expect(result).toMatchObject({ ok: true, value: { entry: { id: entry.id, status: "unpublished" } } });
  expect(await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: entry.id })).toMatchObject({ status: "unpublished" });
  expect(events.map(({ name }) => name)).toContain("entry.unpublished");
  expect(drains()).toBe(3);
});

it("refuses to publish with a non-numeric version before attempting a write", async () => {
  const { deps, drains } = await seeded();
  const { entry } = await createSoup(deps);
  expect(await refusalOf(() => entryLifecycleRoute.handle({ input: { id: entry.id, body: { op: "publish", expectedVersion: "1" } },
    deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
    status: 400, body: { error: "'expectedVersion' (number) is required", code: "VALIDATION_ERROR" },
  });
  expect(await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: entry.id })).toStrictEqual(entry);
  expect(drains()).toBe(1);
});

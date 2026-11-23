import { describe, expect, it } from "vitest";
import { registerContentType, updateContentTypeFields } from "../../../../content-types/index.js";
import { contentTypeLifecycleRoute } from "../lifecycle.js";
import { contentTypeListRoute } from "../list.js";
import { contentTypeRegisterRoute } from "../register.js";
import { contentTypeUpdateFieldsRoute } from "../update-fields.js";
import { makeDeps, MANAGE, PRINCIPAL, READ, RECIPE_FIELDS, recordingAuthorize, refusalOf, signal } from "./helpers.js";

const CT = { entityType: "content-type" };
const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params });

function writeDeps(options: { allowed?: boolean } = {}) {
  const made = makeDeps(options);
  return { ...made, deps: { ...made.deps, registerContentType, updateContentTypeFields } };
}

async function registerRecipe(deps: ReturnType<typeof writeDeps>["deps"]) {
  const { authorize } = recordingAuthorize();
  return contentTypeRegisterRoute.handle({ input: { body: { key: "recipe", label: "Recipe", fields: RECIPE_FIELDS } }, deps, context: PRINCIPAL, authorize }, { signal });
}

describe("contentTypeListRoute", () => {
  it("keeps the path, authorizes the read and lists the workspace's content types", async () => {
    expect([contentTypeListRoute.method, contentTypeListRoute.path]).toEqual(["get", "/api/admin/v1/content-types"]);
    expect(contentTypeListRoute.parse(raw(undefined))).toEqual({ ok: true, value: {} });
    const { deps } = writeDeps();
    await registerRecipe(deps);
    const { authorize, calls } = recordingAuthorize();
    const result = await contentTypeListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...READ, ...CT }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.items.map((item) => item.key)).toEqual(["recipe"]);
  });
});

describe("contentTypeRegisterRoute", () => {
  it("answers 201 with the registered content type after the manage gate", async () => {
    expect([contentTypeRegisterRoute.method, contentTypeRegisterRoute.path, contentTypeRegisterRoute.successStatus]).toEqual(["post", "/api/admin/v1/content-types", 201]);
    expect(contentTypeRegisterRoute.parse(raw(undefined))).toEqual({ ok: true, value: { body: {} } });
    const { deps } = writeDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await contentTypeRegisterRoute.handle({ input: { body: { key: "recipe", label: "Recipe", fields: RECIPE_FIELDS } }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, ...CT }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.contentType.key).toBe("recipe");
  });

  it("refuses a missing key/label with 400 VALIDATION_ERROR", async () => {
    const { deps } = writeDeps();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => contentTypeRegisterRoute.handle({ input: { body: { label: "Recipe" } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'key' (string) and 'label' (string) are required", code: "VALIDATION_ERROR" },
    });
  });

  it("refuses malformed fields through the shared write-error table (400)", async () => {
    const { deps } = writeDeps();
    const { authorize } = recordingAuthorize();
    const refusal = await refusalOf(() => contentTypeRegisterRoute.handle({ input: { body: { key: "recipe", label: "Recipe", fields: "nope" } }, deps, context: PRINCIPAL, authorize }));
    expect(refusal.status).toBe(400);
    expect((refusal.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("maps a duplicate key to 409 CONTENT_TYPE_ALREADY_EXISTS", async () => {
    const { deps } = writeDeps();
    await registerRecipe(deps);
    const refusal = await refusalOf(() => registerRecipe(deps));
    expect(refusal.status).toBe(409);
    expect((refusal.body as { code: string }).code).toBe("CONTENT_TYPE_ALREADY_EXISTS");
  });

  it("maps the write service's own permission re-check to 403 FORBIDDEN", async () => {
    const { deps } = writeDeps({ allowed: false });
    const refusal = await refusalOf(() => registerRecipe(deps));
    expect(refusal.status).toBe(403);
    expect((refusal.body as { code: string }).code).toBe("FORBIDDEN");
  });

  it("rethrows an unmapped write failure to the host error port", async () => {
    const { deps } = writeDeps();
    const fault = new Error("db down");
    const failing = { ...deps, registerContentType: async () => ({ ok: false as const, error: fault }) };
    const { authorize } = recordingAuthorize();
    await expect(contentTypeRegisterRoute.handle({ input: { body: { key: "recipe", label: "Recipe", fields: RECIPE_FIELDS } }, deps: failing, context: PRINCIPAL, authorize })).rejects.toBe(fault);
  });
});

describe("contentTypeUpdateFieldsRoute", () => {
  it("reads :key and replaces the field schema", async () => {
    expect([contentTypeUpdateFieldsRoute.method, contentTypeUpdateFieldsRoute.path]).toEqual(["put", "/api/admin/v1/content-types/:key/fields"]);
    expect(contentTypeUpdateFieldsRoute.parse(raw({ a: 1 }, { key: "recipe" }))).toEqual({ ok: true, value: { key: "recipe", body: { a: 1 } } });
    const { deps } = writeDeps();
    await registerRecipe(deps);
    const { authorize, calls } = recordingAuthorize();
    const fields = [...RECIPE_FIELDS, { name: "serves", kind: "text", required: false, queryable: false }];
    const result = await contentTypeUpdateFieldsRoute.handle({ input: { key: "recipe", body: { expectedVersion: 1, fields } }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, ...CT }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.contentType.fields.map((field) => field.name)).toEqual(["title", "serves"]);
  });

  it("refuses a missing expectedVersion with 400 VALIDATION_ERROR", async () => {
    const { deps } = writeDeps();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => contentTypeUpdateFieldsRoute.handle({ input: { key: "recipe", body: { fields: RECIPE_FIELDS } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'expectedVersion' (number) is required", code: "VALIDATION_ERROR" },
    });
  });

  it("maps an unknown key to 404 CONTENT_TYPE_NOT_FOUND", async () => {
    const { deps } = writeDeps();
    const { authorize } = recordingAuthorize();
    const refusal = await refusalOf(() => contentTypeUpdateFieldsRoute.handle({ input: { key: "nope", body: { expectedVersion: 1, fields: RECIPE_FIELDS } }, deps, context: PRINCIPAL, authorize }));
    expect(refusal.status).toBe(404);
    expect((refusal.body as { code: string }).code).toBe("CONTENT_TYPE_NOT_FOUND");
  });
});

describe("contentTypeLifecycleRoute", () => {
  it("deprecates, then drains the outbox before answering", async () => {
    expect([contentTypeLifecycleRoute.method, contentTypeLifecycleRoute.path]).toEqual(["post", "/api/admin/v1/content-types/:key/lifecycle"]);
    const { deps, events, drains } = writeDeps();
    await registerRecipe(deps);
    const { authorize, calls } = recordingAuthorize();
    const result = await contentTypeLifecycleRoute.handle({ input: { key: "recipe", body: { op: "deprecate", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, ...CT }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.contentType.status).toBe("deprecated");
    expect(events.map((event) => event.name)).toContain("content_type.deprecated");
    expect(drains()).toBe(1);
  });

  it("refuses an unknown op and a missing expectedVersion with 400 VALIDATION_ERROR", async () => {
    const { deps } = writeDeps();
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => contentTypeLifecycleRoute.handle({ input: { key: "recipe", body: { op: "explode", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'op' must be one of 'deprecate', 'reactivate', 'tombstone'", code: "VALIDATION_ERROR" },
    });
    expect(await refusalOf(() => contentTypeLifecycleRoute.handle({ input: { key: "recipe", body: { op: "deprecate" } }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "'expectedVersion' (number) is required", code: "VALIDATION_ERROR" },
    });
  });

  it("maps an illegal transition to 409 and never drains", async () => {
    const { deps, drains } = writeDeps();
    await registerRecipe(deps);
    const { authorize } = recordingAuthorize();
    const refusal = await refusalOf(() => contentTypeLifecycleRoute.handle({ input: { key: "recipe", body: { op: "tombstone", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize }));
    expect(refusal.status).toBe(409);
    expect(drains()).toBe(0);
  });

  it("checks the route gate before validating the body", async () => {
    const { deps } = writeDeps();
    const denied = async () => { throw new Error("denied"); };
    await expect(contentTypeLifecycleRoute.handle({ input: { key: "recipe", body: {} }, deps, context: PRINCIPAL, authorize: denied })).rejects.toThrow("denied");
  });
});

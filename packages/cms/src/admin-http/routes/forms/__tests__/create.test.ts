import { describe, expect, it } from "vitest";
import { DuplicateCommandError } from "../../../../core/index.js";
import { FormFieldValidationError, FormSlugConflictError } from "../../../../forms/index.js";
import { formsCreateRoute, type FormsCreateRouteDeps } from "../create.js";
import { fakeDefinition, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

type Writes = { inputs: unknown[] };

function deps(overrides: Partial<FormsCreateRouteDeps> = {}): FormsCreateRouteDeps & Writes {
  const writes: Writes = { inputs: [] };
  return {
    ...writes,
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }) => error.message,
    createFormDefinition: async ({ input }) => { writes.inputs.push(input); return { definition: fakeDefinition({ name: "Created" }) }; },
    ...overrides,
  };
}

const handle = (form: object, d: FormsCreateRouteDeps, idempotencyKey?: string) =>
  formsCreateRoute.handle({ input: { form: { name: "", slug: "", fields: [], notify: undefined, ...form }, idempotencyKey }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize });

describe("formsCreateRoute", () => {
  it("pins the method, path, 201 and no body cap", () => {
    expect(formsCreateRoute.method).toBe("post");
    expect(formsCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms");
    expect(formsCreateRoute.successStatus).toBe(201);
    expect(formsCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses every body fallback: strings, empty fields, absent notify, and only the authoring keys that were sent", () => {
    expect(formsCreateRoute.parse(raw({}))).toEqual({ ok: true, value: { form: { name: "", slug: "", fields: [], notify: undefined }, idempotencyKey: undefined } });
    const full = { name: 5, slug: "s", fields: [{ id: "a" }], notify: { enabled: true, recipients: [] }, mode: "html", html: "<form></form>", provider: "p" };
    expect(formsCreateRoute.parse({ ...raw({}, { body: full }), headers: { "idempotency-key": "k" } })).toEqual({
      ok: true,
      value: { form: { name: "5", slug: "s", fields: [{ id: "a" }], notify: { enabled: true, recipients: [] }, mode: "html", html: "<form></form>", provider: "p" }, idempotencyKey: "k" },
    });
    expect(formsCreateRoute.parse(raw({}, { body: { fields: "x" } }))).toMatchObject({ value: { form: { fields: [] } } });
    expect(formsCreateRoute.parse({ ...raw({}), headers: { "idempotency-key": "" } })).toMatchObject({ value: { idempotencyKey: undefined } });
  });

  it("makes no route-level authorization call: the write's command gateway decides", async () => {
    const { authorize, calls } = recordingAuthorize();
    await formsCreateRoute.handle({ input: { form: { name: "n", slug: "s", fields: [], notify: undefined }, idempotencyKey: undefined }, deps: deps(), context: PRINCIPAL, authorize });
    expect(calls).toEqual([]);
  });

  it("writes the parsed form as the principal and answers the serialized definition", async () => {
    const d = deps();
    const result = await handle({ name: "Contact", slug: "contact", mode: "html" }, d, "k-1");
    expect(d.inputs).toEqual([{ workspaceId: WORKSPACE_ID, actor: { id: "principal-1", kind: "user" }, name: "Contact", slug: "contact", fields: [], notify: undefined, mode: "html", idempotencyKey: "k-1" }]);
    expect(result.ok && result.value.data).toMatchObject({ id: "form-1", name: "Created" });
  });

  it("answers a duplicate command as 409 DUPLICATE_COMMAND carrying the winning change set", async () => {
    const dup = deps({ createFormDefinition: async () => { throw new DuplicateCommandError({ message: "already ran", changeSetId: "cs-9" }); } });
    expect(await refusalOf(() => handle({}, dup))).toEqual({ status: 409, body: { error: "already ran", code: "DUPLICATE_COMMAND", changeSetId: "cs-9" } });
  });

  it("maps write errors through the shared ladder with the host's copy, and rethrows an unmapped one", async () => {
    const failing = (error: Error) => deps({ outwardErrorMessage: ({ error: e }) => `host: ${e.message}`, createFormDefinition: async () => { throw error; } });
    expect(await refusalOf(() => handle({}, failing(new FormSlugConflictError({ message: "taken", slug: "contact" }))))).toEqual({ status: 409, body: { error: "host: taken", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } });
    expect(await refusalOf(() => handle({}, failing(new FormFieldValidationError({ message: "bad", fieldErrors: [] }))))).toMatchObject({ status: 400, body: { code: "FORMS_FIELD_VALIDATION_ERROR" } });
    await expect(handle({}, failing(new Error("db down")))).rejects.toThrow("db down");
  });

  it("fails closed without an authenticated principal", async () => {
    await expect(formsCreateRoute.handle({ input: { form: { name: "", slug: "", fields: [], notify: undefined }, idempotencyKey: undefined }, deps: deps(), context: undefined, authorize: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});

import { describe, expect, it } from "vitest";
import { menuCreateRoute } from "../create.js";
import { makeWriteDeps, PRINCIPAL, RAW_HTML_PERMISSION, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

describe("menuCreateRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect(menuCreateRoute.method).toBe("post");
    expect(menuCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus");
    expect(menuCreateRoute.successStatus).toBe(201);
    expect(menuCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses title, slug, items and HTML-mode fields off the untyped body", () => {
    expect(menuCreateRoute.parse(raw({}, { title: "Main", slug: "main", items: [], mode: "html", html: "<p>x</p>" }))).toEqual({
      ok: true, value: { title: "Main", slug: "main", items: [], authoring: { mode: "html", html: "<p>x</p>" } },
    });
    expect(menuCreateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { title: "", slug: "", items: undefined, authoring: {} } });
  });

  for (const items of [{}, null, "bad"]) {
    it(`refuses a non-array items ${JSON.stringify(items)} with the host's code-less 400`, async () => {
      expect(await refusalOf(() => menuCreateRoute.parse(raw({}, { items })))).toEqual({ status: 400, body: { error: "items must be an array" } });
    });
  }

  it("authorizes admin.menus.create (no entity id), creates the menu and answers it", async () => {
    const deps = await makeWriteDeps([]);
    const { authorize, calls } = recordingAuthorize();
    const input = { title: "Footer", slug: "footer", items: [], authoring: {} };
    const result = await menuCreateRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.create", entityType: "menu" }]);
    expect(result.ok && result.value.menu.slug).toBe("footer");
    expect((await deps.menuRepo.list({ workspaceId: WORKSPACE_ID })).map((menu) => menu.slug)).toEqual(["footer"]);
  });

  it("asks the injected raw-HTML permission when the body carries HTML, and creates nothing when it is refused", async () => {
    const deps = await makeWriteDeps([]);
    const { authorize, calls } = recordingAuthorize([RAW_HTML_PERMISSION]);
    const input = { title: "Footer", slug: "footer", items: undefined, authoring: { mode: "html" as const, html: "<p>f</p>" } };
    await expect(menuCreateRoute.handle({ input, deps, context: PRINCIPAL, authorize })).rejects.toThrow(`denied ${RAW_HTML_PERMISSION}`);
    expect(calls.map((call) => call.permission)).toEqual(["admin.menus.create", RAW_HTML_PERMISSION]);
    expect(await deps.menuRepo.list({ workspaceId: WORKSPACE_ID })).toEqual([]);
  });

  it("maps a validation failure to 400 and a duplicate slug to 409, both code-less", async () => {
    const deps = await makeWriteDeps();
    const { authorize } = recordingAuthorize();
    const invalid = await refusalOf(() => menuCreateRoute.handle({ input: { title: "X", slug: "x", items: [{ id: "a" } as never], authoring: {} }, deps, context: PRINCIPAL, authorize }));
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body as object)).toEqual(["error"]);
    const duplicate = await refusalOf(() => menuCreateRoute.handle({ input: { title: "Dup", slug: "header-main", items: [], authoring: {} }, deps, context: PRINCIPAL, authorize }));
    expect(duplicate.status).toBe(409);
    expect(Object.keys(duplicate.body as object)).toEqual(["error"]);
  });

  it("rethrows an unmapped failure for the host's 500", async () => {
    const deps = { ...(await makeWriteDeps()), menuRepo: { findBySlug: async () => { throw new Error("db down"); } } as never };
    const { authorize } = recordingAuthorize();
    await expect(menuCreateRoute.handle({ input: { title: "X", slug: "x", items: [], authoring: {} }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
  });
});

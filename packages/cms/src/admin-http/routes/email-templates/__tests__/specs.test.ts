import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { emailTemplateCreateRoute } from "../create.js";
import { emailTemplateEditHtmlRoute } from "../edit-html.js";
import { emailTemplateGetRoute } from "../get.js";
import { emailTemplateListRoute } from "../list.js";
import { emailTemplatePreviewRoute } from "../preview.js";
import { emailTemplateRenameRoute } from "../rename.js";
import { emailTemplateRenderRoute } from "../render.js";
import { EDIT_HTML_PERMISSION, errorDeps, FakeInput, FakeNotFound, FakeVersionConflict, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file The seven email-templates specs: shape, parse, permission, injected operation and the shared error ladder. */

const BASE = "/api/admin/v1/workspaces/:workspaceId/email-templates";
type Call = { op: string; args: unknown };

/** Every operation records its call and answers a tagged object, so a test sees which injected function ran with what. */
function ops(calls: Call[], failWith?: unknown) {
  const op = (name: string) => async (args: unknown) => { calls.push({ op: name, args }); if (failWith) throw failWith; return { ran: name }; };
  return {
    workspaceId: WORKSPACE_ID, editHtmlPermission: EDIT_HTML_PERMISSION, ...errorDeps,
    listTemplates: op("list"), createTemplate: op("create"), previewTemplate: op("preview"), getTemplate: op("get"),
    editTemplate: op("edit"), renameTemplate: op("rename"), renderTemplate: op("render"),
  };
}

type Row = {
  name: string; route: { method: string; path: string; successStatus?: number; maxBodyBytes?: number; parse: (r: ReturnType<typeof raw>) => unknown; handle: (a: never, o?: never) => Promise<unknown> };
  method: string; path: string; status: number | undefined; permission: string; params: Record<string, string>; body: unknown; query?: Record<string, unknown>;
  parsed: unknown; call: Call;
};

const ROWS: Row[] = [
  { name: "list", route: emailTemplateListRoute as never, method: "get", path: BASE, status: undefined, permission: "content.read", params: {}, body: undefined, query: { q: "x" },
    parsed: { query: { q: "x" } }, call: { op: "list", args: { input: { q: "x" } } } },
  { name: "create", route: emailTemplateCreateRoute as never, method: "post", path: BASE, status: 201, permission: EDIT_HTML_PERMISSION, params: {}, body: { name: "W" },
    parsed: { body: { name: "W" } }, call: { op: "create", args: { input: { name: "W" }, actorId: PRINCIPAL.id } } },
  { name: "preview", route: emailTemplatePreviewRoute as never, method: "post", path: `${BASE}/preview`, status: undefined, permission: "content.read", params: {}, body: { id: "t1" },
    parsed: { body: { id: "t1" } }, call: { op: "preview", args: { input: { id: "t1" } } } },
  { name: "get", route: emailTemplateGetRoute as never, method: "get", path: `${BASE}/:templateId`, status: undefined, permission: "content.read", params: { templateId: "t1" }, body: undefined,
    parsed: { templateId: "t1" }, call: { op: "get", args: { id: "t1" } } },
  { name: "edit-html", route: emailTemplateEditHtmlRoute as never, method: "put", path: `${BASE}/:templateId/html`, status: undefined, permission: EDIT_HTML_PERMISSION, params: { templateId: "t1" }, body: { html: "<p>", id: "ignored" },
    parsed: { templateId: "t1", body: { html: "<p>", id: "ignored" } }, call: { op: "edit", args: { input: { html: "<p>", id: "t1" }, actorId: PRINCIPAL.id } } },
  { name: "rename", route: emailTemplateRenameRoute as never, method: "patch", path: `${BASE}/:templateId`, status: undefined, permission: EDIT_HTML_PERMISSION, params: { templateId: "t1" }, body: { name: "N", id: "ignored" },
    parsed: { templateId: "t1", body: { name: "N", id: "ignored" } }, call: { op: "rename", args: { input: { name: "N", id: "t1" } } } },
  { name: "render", route: emailTemplateRenderRoute as never, method: "post", path: `${BASE}/:templateId/render`, status: undefined, permission: "admin.forms.manage", params: { templateId: "t1" }, body: { values: { name: "Bo" } },
    parsed: { templateId: "t1", body: { values: { name: "Bo" } } }, call: { op: "render", args: { id: "t1", values: { name: "Bo" } } } },
];

const handle = (row: Row, deps: unknown, authorize?: unknown, context: unknown = PRINCIPAL) =>
  row.route.handle({ input: (row.route.parse(raw(row.params, row.body, row.query)) as { value: unknown }).value, deps, context, authorize } as never, { signal } as never);

describe.each(ROWS)("email template $name route", (row) => {
  it("keeps its method, path and success status, and leaves the body cap to the host", () => {
    expect([row.route.method, row.route.path, row.route.successStatus, row.route.maxBodyBytes]).toEqual([row.method, row.path, row.status, undefined]);
  });

  it("parses its inputs and never refuses in parse (validation belongs to the operation, after authorization)", () => {
    expect(row.route.parse(raw(row.params, row.body, row.query))).toEqual({ ok: true, value: row.parsed });
  });

  it("authorizes its permission with no entity, then runs exactly its injected operation", async () => {
    const calls: Call[] = [];
    const { authorize, calls: asked } = recordingAuthorize();
    const result = await handle(row, ops(calls), authorize);
    expect(asked).toEqual([{ permission: row.permission, entityType: "" }]);
    expect(calls).toEqual([row.call]);
    expect(result).toEqual({ ok: true, value: { ran: row.call.op } });
  });

  it("runs no operation when authorization refuses", async () => {
    const calls: Call[] = [];
    const { authorize } = recordingAuthorize([row.permission]);
    await expect(handle(row, ops(calls), authorize)).rejects.toThrow(`denied ${row.permission}`);
    expect(calls).toEqual([]);
  });

  it("maps operation failures: not-live 409 with its own code, then 404, 400 and 409 conflict", async () => {
    const live = new EntityNotLiveError({ entityType: "post", entityId: "t1", state: "trashed" });
    const cases: Array<[unknown, { status: number; body: unknown }]> = [
      [live, { status: 409, body: { error: live.message, code: "ENTITY_IN_TRASH" } }],
      [new FakeNotFound("no such template"), { status: 404, body: { error: "no such template", code: "ENTRY_NOT_FOUND" } }],
      [new FakeInput("name is required"), { status: 400, body: { error: "name is required", code: "VALIDATION_ERROR" } }],
      [new FakeVersionConflict("stale version"), { status: 409, body: { error: "stale version", code: "CONCURRENT_EDIT" } }],
    ];
    for (const [failure, expected] of cases) {
      const { authorize } = recordingAuthorize();
      expect(await refusalOf(() => handle(row, ops([], failure), authorize))).toEqual(expected);
    }
  });

  it("rethrows an unmapped failure unchanged, so the host's error port answers the 500", async () => {
    const { authorize } = recordingAuthorize();
    await expect(handle(row, ops([], new Error("private storage details")), authorize)).rejects.toThrow("private storage details");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    const calls: Call[] = [];
    await expect(handle(row, ops(calls), undefined)).rejects.toThrow(/no authorizer/);
    expect(calls).toEqual([]);
  });
});

describe("body and id reading", () => {
  it("reads a missing, array or primitive body as an empty record", () => {
    for (const body of [undefined, null, [1], "text", 7]) {
      expect(emailTemplateCreateRoute.parse(raw({}, body))).toEqual({ ok: true, value: { body: {} } });
    }
  });

  it("reads a missing :templateId as the string the host's `String(req.params.templateId)` made of it", () => {
    expect(emailTemplateGetRoute.parse(raw({}))).toEqual({ ok: true, value: { templateId: "undefined" } });
  });

  it("render hands the raw `values` field to the operation untouched, even when absent", async () => {
    const calls: Call[] = [];
    const { authorize } = recordingAuthorize();
    await emailTemplateRenderRoute.handle({ input: { templateId: "t1", body: {} }, deps: ops(calls), context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ op: "render", args: { id: "t1", values: undefined } }]);
  });

  it("create and edit-html fail closed without an authenticated principal, before authorizing", async () => {
    const { authorize, calls } = recordingAuthorize();
    await expect(emailTemplateCreateRoute.handle({ input: { body: {} }, deps: ops([]), authorize })).rejects.toThrow(/no authenticated principal/);
    await expect(emailTemplateEditHtmlRoute.handle({ input: { templateId: "t1", body: {} }, deps: ops([]), authorize })).rejects.toThrow(/no authenticated principal/);
    expect(calls).toEqual([]);
  });
});

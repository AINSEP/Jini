import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { WIDGET_PREVIEW_RESPONSE_HEADERS, widgetPreviewRoute, type WidgetPreviewRouteDeps } from "../preview.js";

/** @file The widget preview spec: path, headers, the session/permission/body order, the injected
 * renderer and the injected widget-error mapper. */

const signal = new AbortController().signal;
const PRINCIPAL = { id: "reader" };
const BODY = { widgetType: "text", content: { body: "Draft" } };
class KnownWidgetError extends Error {}

function fakeDeps({ fail }: { fail?: Error } = {}): { deps: WidgetPreviewRouteDeps; renders: unknown[] } {
  const renders: unknown[] = [];
  return {
    renders,
    deps: {
      workspaceId: "ws",
      renderPreview: async ({ input }) => { renders.push(input); if (fail) throw fail; return { html: "<p>Draft</p>", document: "<html>doc</html>" }; },
      mapWidgetError: ({ error }) => error instanceof KnownWidgetError ? { status: 400, body: { error: error.message, code: "WIDGETS_TYPE_UNREGISTERED", details: { widgetType: "x" } } } : undefined,
    },
  };
}

function recording({ deny = false }: { deny?: boolean } = {}) {
  const seen: unknown[] = [];
  return {
    seen,
    authorize: async (r: { permission: string; entityType?: string }, o: { entityId?: string } = {}) => {
      seen.push({ ...r, ...o });
      if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
    },
  };
}

type RunOptions = { body?: unknown; deps?: WidgetPreviewRouteDeps; context?: typeof PRINCIPAL | undefined; authorize?: ReturnType<typeof recording>["authorize"] | undefined };

/** Absent keys take the defaults; an explicit `undefined` context/authorizer is kept (the fail-closed cases). */
async function run(options: RunOptions = {}) {
  const body = "body" in options ? options.body : BODY;
  const context = "context" in options ? options.context : PRINCIPAL;
  const authorize = "authorize" in options ? options.authorize : recording().authorize;
  const parsed = widgetPreviewRoute.parse({ params: { workspaceId: "ws" }, query: {}, body });
  if (!parsed.ok) throw new Error("parse refused");
  return widgetPreviewRoute.handle({ input: parsed.value, deps: options.deps ?? fakeDeps().deps, context, ...(authorize === undefined ? {} : { authorize }) }, { signal });
}

async function refusalOf(fn: () => Promise<unknown>) {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a refusal");
}

describe("widgetPreviewRoute", () => {
  it("pins method, path, no body cap and the no-store header on every answer", () => {
    expect(widgetPreviewRoute.method).toBe("post");
    expect(widgetPreviewRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/preview");
    expect(widgetPreviewRoute.maxBodyBytes).toBeUndefined();
    expect(widgetPreviewRoute.successStatus).toBeUndefined();
    expect(widgetPreviewRoute.responseHeaders).toEqual({ "Cache-Control": "no-store" });
    expect(WIDGET_PREVIEW_RESPONSE_HEADERS).toBe(widgetPreviewRoute.responseHeaders);
  });

  it("parse never refuses: the body is read after the session and permission checks", () => {
    for (const body of [undefined, null, [], { widgetType: 1 }]) {
      expect(widgetPreviewRoute.parse({ params: {}, query: {}, body })).toEqual({ ok: true, value: { body } });
    }
  });

  it("no session answers 401 before authorization, a malformed body or any render", async () => {
    const { deps, renders } = fakeDeps();
    const auth = recording();
    expect(await refusalOf(() => run({ deps, context: undefined, authorize: auth.authorize, body: null }))).toEqual({ status: 401, body: { error: "authentication required" } });
    expect(auth.seen).toEqual([]);
    expect(renders).toEqual([]);
  });

  it("asks widgets.read on the widget type with no entity id, and a denial stops the render", async () => {
    const { deps, renders } = fakeDeps();
    const auth = recording();
    expect(await run({ deps, authorize: auth.authorize })).toEqual({ ok: true, value: { html: "<p>Draft</p>", document: "<html>doc</html>" } });
    expect(auth.seen).toEqual([{ permission: "widgets.read", entityType: "widget" }]);
    expect(renders).toEqual([BODY]);
    const denied = fakeDeps();
    expect(await refusalOf(() => run({ deps: denied.deps, authorize: recording({ deny: true }).authorize, body: null }))).toEqual({ status: 403, body: { error: "denied" } });
    expect(denied.renders).toEqual([]);
  });

  it("refuses every malformed body after authorization with the flat validation 400", async () => {
    for (const body of [null, [], {}, { widgetType: 1, content: {} }, { widgetType: "text", content: [] }, { widgetType: "text", content: {}, role: "admin" }]) {
      const { deps, renders } = fakeDeps();
      expect(await refusalOf(() => run({ deps, body }))).toEqual({ status: 400, body: { error: "widgetType and content are required", code: "VALIDATION_ERROR" } });
      expect(renders).toEqual([]);
    }
  });

  it("answers a mapped widget error with the mapper's exact status and body", async () => {
    const { deps } = fakeDeps({ fail: new KnownWidgetError("widget type is unregistered") });
    expect(await refusalOf(() => run({ deps }))).toEqual({ status: 400, body: { error: "widget type is unregistered", code: "WIDGETS_TYPE_UNREGISTERED", details: { widgetType: "x" } } });
  });

  it("rethrows an unmapped failure unchanged for the host's redacted 500", async () => {
    const failure = new Error("private detail");
    await expect(run({ deps: fakeDeps({ fail: failure }).deps })).rejects.toBe(failure);
  });

  it("fails closed without an authorizer (a wiring bug)", async () => {
    await expect(run({ authorize: undefined })).rejects.toThrow(/no authorizer/);
  });
});

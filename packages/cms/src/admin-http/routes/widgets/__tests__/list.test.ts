import { describe, expect, it } from "vitest";
import { InMemoryEntryRepo } from "../../../../entries/repo.memory.js";
import { widgetListRoute } from "../list.js";
import { forbidden, PRINCIPAL, rbac, refusalOf, signal, WORKSPACE_ID, plainOutward } from "./helpers.js";

const raw = (query: Record<string, unknown>) => ({ body: {}, query, params: { workspaceId: WORKSPACE_ID } });
const repo = new InMemoryEntryRepo();

describe("widgetListRoute", () => {
  it("keeps the path and reads only a string widgetType and a literal includeInactive=true", () => {
    expect(widgetListRoute.method).toBe("get");
    expect(widgetListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets");
    expect(widgetListRoute.parse(raw({ widgetType: "text", includeInactive: "true" }))).toEqual({ ok: true, value: { widgetType: "text", includeInactive: true } });
    expect(widgetListRoute.parse(raw({ widgetType: ["text"], includeInactive: "1" }))).toEqual({ ok: true, value: { includeInactive: false } });
  });

  it("lists through the widgets.read-gated service and omits skipped fields when nothing was skipped", async () => {
    const { authorize, calls } = rbac(true);
    const result = await widgetListRoute.handle({ input: { includeInactive: false }, deps: { workspaceId: WORKSPACE_ID, outwardErrorMessage: plainOutward, entryRepo: repo, authorize }, context: PRINCIPAL, authorize: async () => {} }, { signal });
    expect(result).toEqual({ ok: true, value: { widgets: [] } });
    expect(calls).toEqual([{ principalId: "principal-1", permission: "widgets.read", workspaceId: WORKSPACE_ID }]);
  });

  it("refuses a caller without widgets.read with the WIDGETS_FORBIDDEN body", async () => {
    const { authorize } = rbac(false);
    const refusal = await refusalOf(() => widgetListRoute.handle({ input: { includeInactive: false }, deps: { workspaceId: WORKSPACE_ID, outwardErrorMessage: plainOutward, entryRepo: repo, authorize }, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.read"));
  });
});

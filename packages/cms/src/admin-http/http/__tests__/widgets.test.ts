import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { WidgetForbiddenError, WidgetVersionConflictError } from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetAreaResponse, toAdminWidgetResponse, widgetDomainErrorToResponse } from "../widgets.js";

describe("admin widgets HTTP mapping", () => {
  it("wraps instances and areas in their response keys", () => {
    const widget = { id: "w-1" } as never;
    const area = { id: "a-1" } as never;
    expect(toAdminWidgetResponse(widget).widget).toBe(widget);
    expect(toAdminWidgetAreaResponse(area).area).toBe(area);
  });

  it("maps domain errors and extracts the forbidden permission/reason", () => {
    expect(widgetDomainErrorToResponse({ err: new WidgetVersionConflictError({ message: "stale", currentVersion: 4 }) })).toEqual({ status: 409, body: { error: "stale", code: "WIDGETS_VERSION_CONFLICT", details: { currentVersion: 4 } } });
    expect(widgetDomainErrorToResponse({ err: new WidgetForbiddenError({ message: "principal 'p' lacks permission 'widgets.read' (no_grant)" }) })).toEqual({
      status: 403, body: { error: "principal 'p' lacks permission 'widgets.read' (no_grant)", code: "WIDGETS_FORBIDDEN", details: { permission: "widgets.read", reason: "no_grant" } },
    });
    expect(widgetDomainErrorToResponse({ err: new WidgetForbiddenError({ message: "odd" }) })?.body).toMatchObject({ details: { permission: "", reason: "" } });
    expect(widgetDomainErrorToResponse({ err: new Error("other") })).toBeUndefined();
  });

  it("refuses a mapped error and rethrows anything else unchanged", () => {
    expect(() => rejectWidgetError({ err: new WidgetVersionConflictError({ message: "stale", currentVersion: 1 }) })).toThrow(RouteRefusalError);
    const other = new Error("other");
    expect(() => rejectWidgetError({ err: other })).toThrow(other);
  });
});

import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import {
  WidgetAreaConflictError, WidgetAreaNotFoundError, WidgetConfigValidationError, WidgetEmbedGuardrailError,
  WidgetEmbedHostNotFoundError, WidgetEmbedHostUnsupportedError, WidgetEmbedPlacementNotFoundError,
  WidgetEmbedReorderCountMismatchError, WidgetForbiddenError, WidgetInstanceNotFoundError,
  WidgetReferencedError, WidgetTypeUnregisteredError, WidgetVersionConflictError,
} from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetAreaResponse, toAdminWidgetResponse, widgetDomainErrorToResponse } from "../widgets.js";

const plain = ({ error }: { error: Error }) => error.message;
const hosted = ({ error }: { error: Error }) => `host: ${error.message}`;

describe("admin widgets HTTP mapping", () => {
  it("fills the error copy from the host's outward message, keeping status, code and details", () => {
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: hosted, err: new WidgetVersionConflictError({ message: "stale", currentVersion: 4 }) }))
      .toEqual({ status: 409, body: { error: "host: stale", code: "WIDGETS_VERSION_CONFLICT", details: { currentVersion: 4 } } });
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: hosted, err: new WidgetForbiddenError({ message: "principal 'p' lacks permission 'widgets.read' (no_grant)" }) })?.body)
      .toEqual({ error: "host: principal 'p' lacks permission 'widgets.read' (no_grant)", code: "WIDGETS_FORBIDDEN", details: { permission: "widgets.read", reason: "no_grant" } });
  });

  it("wraps instances and areas in their response keys", () => {
    const widget = { id: "w-1" } as never;
    const area = { id: "a-1" } as never;
    expect(toAdminWidgetResponse(widget).widget).toBe(widget);
    expect(toAdminWidgetAreaResponse(area).area).toBe(area);
  });

  it("maps domain errors and extracts the forbidden permission/reason", () => {
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: plain, err: new WidgetVersionConflictError({ message: "stale", currentVersion: 4 }) })).toEqual({ status: 409, body: { error: "stale", code: "WIDGETS_VERSION_CONFLICT", details: { currentVersion: 4 } } });
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: plain, err: new WidgetForbiddenError({ message: "principal 'p' lacks permission 'widgets.read' (no_grant)" }) })).toEqual({
      status: 403, body: { error: "principal 'p' lacks permission 'widgets.read' (no_grant)", code: "WIDGETS_FORBIDDEN", details: { permission: "widgets.read", reason: "no_grant" } },
    });
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: plain, err: new WidgetForbiddenError({ message: "odd" }) })?.body).toMatchObject({ details: { permission: "", reason: "" } });
    expect(widgetDomainErrorToResponse({ outwardErrorMessage: plain, err: new Error("other") })).toBeUndefined();
  });

  it("refuses a mapped error and rethrows anything else unchanged", () => {
    expect(() => rejectWidgetError({ outwardErrorMessage: plain, err: new WidgetVersionConflictError({ message: "stale", currentVersion: 1 }) })).toThrow(RouteRefusalError);
    const other = new Error("other");
    expect(() => rejectWidgetError({ outwardErrorMessage: plain, err: other })).toThrow(other);
  });
});

it.each([
  { err: new WidgetConfigValidationError({ message: "bad color", fieldErrors: [{ field: "color", reason: "unknown" }] }),
    status: 400, code: "WIDGETS_CONFIG_VALIDATION_ERROR", details: { fieldErrors: [{ field: "color", reason: "unknown" }] } },
  { err: new WidgetTypeUnregisteredError({ message: "type gone", widgetType: "gallery" }),
    status: 400, code: "WIDGETS_TYPE_UNREGISTERED", details: { widgetType: "gallery" } },
  { err: new WidgetEmbedReorderCountMismatchError({ message: "wrong count", expectedCount: 4, actualCount: 2 }),
    status: 400, code: "WIDGETS_EMBED_REORDER_COUNT_MISMATCH", details: { expectedCount: 4, actualCount: 2 } },
  { err: new WidgetEmbedGuardrailError({ message: "nested embed", reason: "recursion" }),
    status: 400, code: "WIDGETS_EMBED_GUARDRAIL_VIOLATION", details: { reason: "recursion" } },
  { err: new WidgetAreaConflictError({ message: "stale area", currentVersion: 8 }),
    status: 409, code: "WIDGETS_AREA_CONFLICT", details: { currentVersion: 8 } },
  { err: new WidgetReferencedError({ message: "still placed", referencingLocations: [{ kind: "embed", entryId: "post-5" }] }),
    status: 409, code: "WIDGETS_REFERENCED", details: { referencingLocations: [{ kind: "embed", entryId: "post-5" }] } },
  { err: new WidgetInstanceNotFoundError({ message: "widget gone" }), status: 404, code: "WIDGETS_INSTANCE_NOT_FOUND" },
  { err: new WidgetAreaNotFoundError({ message: "area gone" }), status: 404, code: "WIDGETS_AREA_NOT_FOUND" },
  { err: new WidgetEmbedHostNotFoundError({ message: "host gone" }), status: 404, code: "WIDGETS_EMBED_HOST_NOT_FOUND" },
  { err: new WidgetEmbedPlacementNotFoundError({ message: "placement gone" }), status: 404, code: "WIDGETS_EMBED_PLACEMENT_NOT_FOUND" },
  { err: new WidgetEmbedHostUnsupportedError({ message: "no document body", reason: "html-page" }),
    status: 400, code: "WIDGETS_EMBED_HOST_UNSUPPORTED", details: { reason: "html-page" } },
])("exposes $code with its own status and repair details", ({ err, status, code, details }) => {
  const outwardErrorMessage = () => "Contact the workspace editor.";
  expect(widgetDomainErrorToResponse({ err, outwardErrorMessage })).toStrictEqual({
    status, body: { error: "Contact the workspace editor.", code, ...(details === undefined ? {} : { details }) },
  });
});

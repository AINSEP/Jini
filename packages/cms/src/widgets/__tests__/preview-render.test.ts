import { describe, expect, it } from "vitest";
import { WidgetConfigValidationError, WidgetTypeUnregisteredError } from "../errors.js";
import { resolveWidgetPreviewIr } from "../site/preview-render.js";
import type { resolveWidgetType } from "../resolvers/index.js";

const PLACEHOLDER = { componentId: "widget-placeholder", props: {} };
const input = { widgetType: "text", content: { body: "Draft" } };
type Resolve = typeof resolveWidgetType;

describe("resolveWidgetPreviewIr", () => {
  it("answers the resolved IR and asks the resolver for the one unsaved, non-preview instance", async () => {
    const calls: Parameters<Resolve>[0][] = [];
    const resolve: Resolve = async (required) => {
      calls.push(required);
      return new Map([["unsaved-widget-preview", { ok: true, ir: { componentId: "text", props: { body: "R" } }, dependencyKeys: [] }]]);
    };
    expect(await resolveWidgetPreviewIr({ input, workspaceId: "ws" }, { resolve })).toEqual({ componentId: "text", props: { body: "R" } });
    expect(calls).toEqual([{ typeKey: "text", instances: [{ id: "unsaved-widget-preview", widgetType: "text", config: { body: "Draft" } }], context: { workspaceId: "ws", preview: false } }]);
  });

  it("selects the placeholder IR when the resolver answers nothing for the instance", async () => {
    expect(await resolveWidgetPreviewIr({ input, workspaceId: "ws" }, { resolve: async () => new Map() })).toEqual(PLACEHOLDER);
  });

  it("selects the placeholder IR when the resolver answers a failure for the instance", async () => {
    const resolve: Resolve = async () => new Map([["unsaved-widget-preview", { ok: false, reason: "timeout" }]]);
    expect(await resolveWidgetPreviewIr({ input, workspaceId: "ws" }, { resolve })).toEqual(PLACEHOLDER);
  });

  it("resolves through the real registry when no resolver is injected", async () => {
    expect(await resolveWidgetPreviewIr({ input, workspaceId: "ws" })).toEqual({ componentId: "text", props: { body: "Draft" } });
  });

  it("throws the typed error for an unregistered type before touching the resolver", async () => {
    const resolve: Resolve = async () => { throw new Error("must not resolve"); };
    await expect(resolveWidgetPreviewIr({ input: { widgetType: "nope", content: {} }, workspaceId: "ws" }, { resolve })).rejects.toBeInstanceOf(WidgetTypeUnregisteredError);
  });

  it("throws the typed error, with field errors, for an invalid config before touching the resolver", async () => {
    const resolve: Resolve = async () => { throw new Error("must not resolve"); };
    const error = await resolveWidgetPreviewIr({ input: { widgetType: "text", content: { body: 5 } }, workspaceId: "ws" }, { resolve }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WidgetConfigValidationError);
    expect((error as WidgetConfigValidationError).fieldErrors.length).toBeGreaterThan(0);
  });
});

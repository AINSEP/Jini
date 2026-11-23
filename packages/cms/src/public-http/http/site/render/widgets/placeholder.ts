import type { WidgetRenderIR } from "../../../../../widgets/index.js";

// ---------------------------------------------------------------------------
// Widget IR rendering (SPEC-043/ADR-047 W-004) — renders `resolvePageWidgets`'s
// output (`WidgetRenderIR { componentId, props, children? }`), NOT theme-authored
// `TemplateNode` data. Deliberately a separate switch, not folded into `COMPONENTS`:
// `COMPONENTS`/`Component` resolve theme-authored `{type:"component", id, props}`
// nodes and have no concept of an IR's `children` array; widget IR is core-produced,
// closed-vocabulary data (exactly the five v1 `componentId`s the widget-type
// registry can ever emit, plus the `widget-placeholder` failure IR — see
// `Jini/packages/cms/src/widgets/registry.ts`/`resolver-service.ts`). Both render tiers reach this
// same function — the declarative tier via `renderBlock`'s new `region` node kind,
// the Liquid tier via `liquid-worker.ts`'s extended `render_block` tag — so ADR-047
// §2a's "no new Liquid capability required, both placement paths resolve to
// something the renderer already knows how to receive" holds for regions the same
// way it already held for the original four components.
// ---------------------------------------------------------------------------

/** REQ-28: a widget resolution failure (or, here, an unresolvable IR reaching the renderer some
 * other way) renders an isolated, public-safe placeholder — no internal error detail. */
export const WIDGET_PLACEHOLDER_IR: WidgetRenderIR = { componentId: "widget-placeholder", props: {} };

/** REQ-28: no internal detail, no stack trace, no configuration secret — the placeholder itself
 * carries nothing beyond a static, styleable marker. */
export function renderWidgetPlaceholder(): string {
  return `<div class="widget widget-placeholder" aria-hidden="true"></div>`;
}

import { expect, test } from "vitest";
import { renderWidgetPlaceholder, WIDGET_PLACEHOLDER_IR } from "../placeholder.js";

// Named mutations rejected: dropping the styleable `widget-placeholder` marker, exposing the
// placeholder to assistive tech, or letting the failure IR carry props (internal detail).
test("a failed widget renders one static, hidden, styleable marker and nothing else (REQ-28)", () => {
  expect(renderWidgetPlaceholder()).toBe('<div class="widget widget-placeholder" aria-hidden="true"></div>');
  expect(WIDGET_PLACEHOLDER_IR).toEqual({ componentId: "widget-placeholder", props: {} });
});

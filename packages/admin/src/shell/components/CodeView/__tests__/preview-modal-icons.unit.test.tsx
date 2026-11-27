// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { CODE_PREVIEW_MODAL_ICONS } from "../preview-modal-icons.js";

it("overrides only the exit-fullscreen icon with the inward diagonal glyph", () => {
  const ExitIcon = CODE_PREVIEW_MODAL_ICONS["fullscreen-exit"];
  const kit = fakeAdminKit({ components: {
    RemixIcon: ({ name, size }) => <i aria-hidden="true" data-glyph={name} data-size={size} />,
  } });
  const { container } = render(<AdminKitProvider kit={kit}><ExitIcon /></AdminKitProvider>);
  expect(Object.keys(CODE_PREVIEW_MODAL_ICONS)).toEqual(["fullscreen-exit"]);
  const icon = container.querySelector('[data-glyph="collapse-diagonal-line"]');
  expect(icon?.getAttribute("data-size")).toBe("16");
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
});

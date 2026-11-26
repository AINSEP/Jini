// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { paintAdminAccent } from "../paint-admin-accent.js";

it("paints the fill and both ink variables, then clears the same overrides", () => {
  const root = document.createElement("div");
  const readableTextColor = vi.fn(() => "#000000");
  paintAdminAccent({ accent: "#ffe100", root, deps: { readableTextColor } });
  expect(readableTextColor).toHaveBeenCalledWith({ hex: "#ffe100" });
  expect(root.style.getPropertyValue("--jini-theme-light-primary")).toBe("#ffe100");
  expect(root.style.getPropertyValue("--jini-theme-dark-primary")).toBe("#ffe100");
  expect(root.style.getPropertyValue("--jini-theme-light-primary-ink")).toBe("#000000");
  expect(root.style.getPropertyValue("--jini-theme-dark-primary-ink")).toBe("#000000");
  expect(root.getAttribute("data-admin-accent")).toBe("light");
  paintAdminAccent({ accent: undefined, root, deps: { readableTextColor } });
  expect(root.style.getPropertyValue("--jini-theme-light-primary")).toBe("");
  expect(root.style.getPropertyValue("--jini-theme-dark-primary")).toBe("");
  expect(root.style.getPropertyValue("--jini-theme-light-primary-ink")).toBe("");
  expect(root.style.getPropertyValue("--jini-theme-dark-primary-ink")).toBe("");
  expect(root.hasAttribute("data-admin-accent")).toBe(false);
});

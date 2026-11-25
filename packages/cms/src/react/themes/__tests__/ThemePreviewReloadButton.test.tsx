import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { WiredThemePreviewReloadButton } from "../ThemePreviewReloadButton.js";

const PreviewReloadControl: Parameters<typeof WiredThemePreviewReloadButton>[0]["PreviewReloadControl"] = ({ className, label, reload, disabled }) => (
  <button className={className} disabled={disabled} onClick={reload}>{label}</button>
);

test("forwards the supplied label, disabled state and reload click", () => {
  const reload = vi.fn();
  const reloadPreviews = vi.fn(async () => {});
  const useThemePreviewReloadButtonHook = vi.fn(() => ({ label: "Refresh artwork", reload, error: null }));
  const { rerender } = render(
    <WiredThemePreviewReloadButton PreviewReloadControl={PreviewReloadControl} useThemePreviewReloadButtonHook={useThemePreviewReloadButtonHook} disabled reloadPreviews={reloadPreviews} />,
  );
  expect(screen.getByRole("button", { name: "Refresh artwork" }).getAttribute("disabled")).toBe("");
  expect(useThemePreviewReloadButtonHook).toHaveBeenCalledWith({}, { reload: reloadPreviews });
  rerender(
    <WiredThemePreviewReloadButton PreviewReloadControl={PreviewReloadControl} useThemePreviewReloadButtonHook={useThemePreviewReloadButtonHook} disabled={false} reloadPreviews={reloadPreviews} />,
  );
  const button = screen.getByRole("button", { name: "Refresh artwork" });
  expect(button.getAttribute("disabled")).toBeNull();
  fireEvent.click(button);
  expect(reload).toHaveBeenCalledTimes(1);
});

test("PREVIEW-RELOAD-ERROR changes only the alert when the supplied hook reports an error", () => {
  const reload = vi.fn();
  let error: string | null = null;
  const useThemePreviewReloadButtonHook = vi.fn(() => ({ label: "Refresh artwork", reload, error }));
  const { rerender } = render(
    <WiredThemePreviewReloadButton PreviewReloadControl={PreviewReloadControl} useThemePreviewReloadButtonHook={useThemePreviewReloadButtonHook} />,
  );
  const button = screen.getByRole("button", { name: "Refresh artwork" }).outerHTML;
  expect(screen.queryByRole("alert")).toBeNull();
  error = "Preview unavailable";
  rerender(
    <WiredThemePreviewReloadButton PreviewReloadControl={PreviewReloadControl} useThemePreviewReloadButtonHook={useThemePreviewReloadButtonHook} />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Preview unavailable");
  expect(screen.getByRole("button", { name: "Refresh artwork" }).outerHTML).toBe(button);
});

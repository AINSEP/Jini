import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { MediaPickerDialog, type MediaPickerDialogProps } from "../MediaPickerDialog.js";
import { acceptedMediaItems } from "../MediaPickerDialog.hooks.js";

afterEach(cleanup);

test("both picker backends keep cancellation and the host redaction port", () => {
  const onCancel = vi.fn();
  const useJiniMediaPickerHook = vi.fn<MediaPickerDialogProps["useJiniMediaPickerHook"]>(() => ({ enabled: false, error: null, onCancel }));
  const errorRedaction = { exactSecrets: ["private"] };
  const props = {
    onSelect: vi.fn(), onCancel, useJiniMediaPickerHook, useHostMediaPickerHook: () => null, useAdminLocaleHook: () => "en",
    useDialog: () => ({ items: null, error: null, select: vi.fn(), mediaOriginalUrl: () => "/media", t: (key: string) => key, locale: "en" }),
    Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>, FailureNotice: () => <div />,
    translate: ({ key }: { locale: string; key: string }) => key, acceptsMedia: () => true,
    pickerHostArgs: { port: { listMedia: async () => ({ media: [] }) }, errorRedaction, errorIdOf: () => undefined, useCachedLoader: vi.fn() },
  } satisfies MediaPickerDialogProps;
  const view = render(<MediaPickerDialog {...props} />);
  expect(view.getByText("Loading media…")).toBeTruthy();
  expect(useJiniMediaPickerHook.mock.calls[0]?.[0].errorRedaction).toBe(errorRedaction);
  expect(useJiniMediaPickerHook.mock.calls[0]?.[0]).not.toHaveProperty("useDialog");
  fireEvent.click(view.getByText("Cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  useJiniMediaPickerHook.mockReturnValue({ enabled: true, error: null, onCancel });
  view.rerender(<MediaPickerDialog {...props} />);
  expect(view.queryByText("Loading media…")).toBeNull();
  expect(acceptedMediaItems({ items: null, acceptsMedia: () => true })).toBeNull();
  expect(acceptedMediaItems({ items: [], acceptsMedia: () => true })).toEqual([]);
});

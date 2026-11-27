import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { MediaPickerDialog, type MediaPickerDialogProps } from "../MediaPickerDialog.js";
import { acceptedMediaItems, useMediaPickerDialog } from "../MediaPickerDialog.hooks.js";

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

function asset(id: string, title: string, contentType: string, options: { alt?: string; status?: AdminMedia["status"] } = {}): AdminMedia {
  return { id, title, contentType, alt: options.alt ?? "", status: options.status ?? "active",
    kind: "media", workspaceId: "coast", slug: id, caption: "", credit: "", sha256: "source-" + id,
    originalFilename: null, displayFilename: id, createdBy: null, byteSize: 4, createdAt: "now", updatedAt: "now",
    version: 1, width: null, height: null, cssClass: null, htmlAttributes: null, publicUrl: null };
}

function pickerProps() {
  const onCancel = vi.fn();
  const onSelect = vi.fn<(item: AdminMedia) => void>();
  const translate = ({ key }: { locale: string; key: string }) => key;
  const props: MediaPickerDialogProps = {
    onCancel, onSelect, useJiniMediaPickerHook: () => ({ enabled: false, error: null, onCancel }),
    useHostMediaPickerHook: () => null, useAdminLocaleHook: () => "en",
    useDialog: () => ({ items: [], error: null, select: onSelect, mediaOriginalUrl: ({ id }) => "/media/" + id, t: key => key, locale: "en" }),
    Dialog: ({ title, children, onClose }) => <section role="dialog" aria-label={title}><button onClick={onClose}>Close</button>{children}</section>,
    FailureNotice: ({ failure }) => <p>{failure.message}</p>, translate,
    acceptsMedia: ({ item, accept }) => accept.length === 0 || accept.includes(item.contentType ?? ""),
    pickerHostArgs: { port: { listMedia: async () => ({ media: [] }) }, errorRedaction: {}, errorIdOf: () => undefined, useCachedLoader: vi.fn() },
  };
  return { props, onSelect, onCancel };
}

test("offers the Media link in an empty library and renders only eligible items with thumbnail alt and handles", () => {
  const { props, onSelect, onCancel } = pickerProps();
  const coast = asset("coast", "Coast at dusk", "image/png", { alt: "Waves at dusk" });
  const cliffs = asset("cliffs", "Cliff path", "image/png");
  const video = asset("journey", "Video journey", "video/mp4");
  const mediaOriginalUrl = vi.fn(({ id }: { id: string }) => "/asset/" + id);
  const view = render(<MediaPickerDialog {...props} agentHandle="cover" accept={["image/png"]} />);
  expect(view.getByRole("link", { name: "Media" })).toHaveAttribute("href", "/admin/media");
  expect(view.getByText("No media uploaded yet.", { exact: false })).toHaveTextContent("No media uploaded yet. Upload an asset from the Media screen first.");
  view.rerender(<MediaPickerDialog {...props} agentHandle="cover" accept={["image/png"]}
    useDialog={required => ({ ...props.useDialog(required), items: [coast, video, cliffs], mediaOriginalUrl })}
  />);
  expect(view.queryByRole("button", { name: /Video journey/ })).toBeNull();
  expect(view.getByRole("img", { name: "Waves at dusk" })).toHaveAttribute("src", "/asset/coast");
  expect(view.getByRole("img", { name: "Cliff path" })).toHaveAttribute("src", "/asset/cliffs");
  const choice = view.getByRole("button", { name: /Cliff path/ });
  expect(choice).toHaveAttribute("data-agent-element", "cover-item-cliffs");
  fireEvent.click(choice);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(cliffs);
  expect(mediaOriginalUrl.mock.calls).toEqual([[{ id: "coast" }], [{ id: "cliffs" }]]);
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(onCancel).toHaveBeenCalledExactlyOnceWith();
});

test("the hosted picker renders its safe error and uses its cancellation instead of opening the legacy dialog", () => {
  const { props, onCancel } = pickerProps();
  const cancelHosted = vi.fn();
  const error = { message: "Cannot access the media library.", action: "Try later", step: "Choose image", cause: "Offline", copyText: "Offline" };
  const view = render(<MediaPickerDialog {...props} useAdminLocaleHook={() => "fr"}
    translate={({ key, locale }) => locale === "fr" && key === "Cancel" ? "Annuler" : key}
    useJiniMediaPickerHook={() => ({ enabled: true, error, onCancel: cancelHosted })}
  />);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByRole("alert")).toHaveTextContent("Cannot access the media library.");
  fireEvent.click(view.getByRole("button", { name: "Annuler" }));
  expect(cancelHosted).toHaveBeenCalledExactlyOnceWith();
  expect(onCancel).not.toHaveBeenCalled();
});

test.each(["success", "failure"] as const)("renders the real legacy controller across a %s query settlement", async outcome => {
  const { props, onSelect } = pickerProps();
  const visible = asset("coast", "Coast at dusk", "image/png", { alt: "Waves at dusk" });
  const trashed = asset("archived", "Archived beach", "image/png", { status: "trashed" });
  let resolve!: (value: { media: AdminMedia[] }) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<{ media: AdminMedia[] }>((accept, refuse) => { resolve = accept; reject = refuse; });
  const listMedia = vi.fn(() => pending);
  const mediaOriginalUrl = vi.fn(({ id }: { id: string }) => "/original/" + id);
  const describeError = vi.fn(({ fallback }: { e: unknown; fallback: string }) => fallback);
  const translate = ({ key, locale }: { key: string; locale: string }) => locale + ": " + key;
  const queryRequests = vi.fn();
  const useFetchQueryHook: FetchQueryAdapter["useFetchQuery"] = function useFixtureQuery<T>({ key, fetch }: Omit<Parameters<FetchQueryAdapter["useFetchQuery"]>[0], "fetch"> & { fetch: () => Promise<T> }, options?: Parameters<FetchQueryAdapter["useFetchQuery"]>[1]) {
    const [state, setState] = useState<{ data: T | undefined; error: Error | null }>({ data: undefined, error: null });
    useEffect(() => {
      let active = true;
      queryRequests({ key, staleTime: options?.staleTime });
      void fetch().then(data => {
        if (active) setState({ data, error: null });
      }, (error: Error) => {
        if (active) setState({ data: undefined, error });
      });
      return () => { active = false; };
    }, [fetch]);
    return { ...state, status: state.error ? "error" : state.data === undefined ? "loading" : "success",
      isFetching: state.data === undefined && state.error === null, refetch: () => {} };
  };
  const port = { listMedia, mediaOriginalUrl };
  const view = render(<MediaPickerDialog {...props} useDialog={function useFixtureDialog({ onSelect, onCancel }) {
    return useMediaPickerDialog({ onSelect, _onCancel: onCancel, deps: { port, locale: "fr" }, useFetchQueryHook, describeError, translate });
  }} />);
  expect(view.getByText("fr: Loading media…")).toBeVisible();
  expect(queryRequests).toHaveBeenCalledExactlyOnceWith({ key: ["media"], staleTime: 0 });
  expect(listMedia).toHaveBeenCalledExactlyOnceWith();
  const error = new Error("private server detail");
  await act(async () => {
    if (outcome === "success") resolve({ media: [visible, trashed] });
    else reject(error);
  });
  if (outcome === "success") {
    expect(view.queryByText("fr: Loading media…")).toBeNull();
    expect(view.queryByRole("button", { name: /Archived beach/ })).toBeNull();
    expect(view.getByRole("img", { name: "Waves at dusk" })).toHaveAttribute("src", "/original/coast");
    fireEvent.click(view.getByRole("button", { name: /Coast at dusk/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(visible);
  } else {
    expect(describeError).toHaveBeenCalledExactlyOnceWith({ e: error, fallback: "fr: failed to load media" });
    expect(view.getByText("fr: failed to load media")).toBeVisible();
    expect(view.queryByText("private server detail")).toBeNull();
  }
});

import '@testing-library/jest-dom/vitest';
/** Quick wins A: visible URL-import action, retryable errors, and media-list invalidation. */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import { useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { Button, Dialog, TextField } from "@jini-ai/ui-kit/react";
import { RemoteImageImport } from "../RemoteImageImport.js";
import { useRemoteImageImport } from "../use-remote-image-import.hooks.js";
import type { ImportDialogKit, MediaImportPort } from "../ports.js";

const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
const kit = { Button, Dialog, TextField } satisfies ImportDialogKit;
const LIST_KEY = ["media"];
const describeError = ({ e, fallback }: { e: unknown; fallback: string }) => (e instanceof Error && e.message ? e.message : fallback);
const HeaderTip = ({ label, children }: { label: string; children: ReactNode }) => <span data-tip={label}>{children}</span>;
/** A fake host port; the dialog only needs the call and the list key it invalidates. */
const portOf = (importFromUrl: (...args: never[]) => unknown): MediaImportPort =>
  ({ importFromUrl: importFromUrl as MediaImportPort["importFromUrl"], listKey: LIST_KEY });
const hookArgs = (importFromUrl: (...args: never[]) => unknown) => ({ t: (key: string) => key, port: portOf(importFromUrl), describeError, useFetchMutation });
const renderDialog = (importFromUrl: (...args: never[]) => unknown) =>
  render(<RemoteImageImport {...hookArgs(importFromUrl)} HeaderTip={HeaderTip} kit={kit} />, { wrapper });

describe("remote media import", () => {
  it("ignores a direct submit with an invalid URL and preserves the draft", async () => {
    const importFromUrl = vi.fn();
    const { result } = renderHook(() => useRemoteImageImport(hookArgs(importFromUrl)), { wrapper });
    act(() => result.current.setUrl("http://cdn.example/fox.png"));

    await act(async () => result.current.submit());

    expect(importFromUrl).not.toHaveBeenCalled();
    expect(result.current.url).toBe("http://cdn.example/fox.png");
    expect(result.current.urlInvalid).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("sends only one import when submitted twice before the first request settles", async () => {
    let resolveImport!: () => void;
    const importFromUrl = vi.fn(() => new Promise<Awaited<ReturnType<MediaImportPort["importFromUrl"]>>>((resolve) => {
      resolveImport = () => resolve({ media: {
        id: "new-media", workspaceId: "w1", title: "Fox", slug: "fox", alt: "", caption: "", credit: "",
        sha256: "f".repeat(64), status: "active", createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
        version: 1, width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: "/m/fox",
      } });
    }));
    const { result } = renderHook(() => useRemoteImageImport(hookArgs(importFromUrl)), { wrapper });
    act(() => result.current.setUrl("https://cdn.example/fox.png"));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.submit();
      await result.current.submit();
    });

    expect(importFromUrl).toHaveBeenCalledTimes(1);
    expect(importFromUrl).toHaveBeenCalledWith({ url: "https://cdn.example/fox.png" }, { alt: undefined });
    expect(result.current.url).toBe("https://cdn.example/fox.png");
    await act(async () => { resolveImport(); await first; });
    expect(result.current.url).toBe("");
    expect(result.current.open).toBe(false);
  });

  it("closes the URL dialog without submitting or clearing its draft", async () => {
    const importFromUrl = vi.fn();
    renderDialog(importFromUrl);
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: "https://cdn.example/fox.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.querySelector(".jini-media-import-dialog")).not.toHaveAttribute("open");
    expect(importFromUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    expect(screen.getByLabelText("Remote image URL")).toHaveValue("https://cdn.example/fox.png");
  });

  it("presents the URL action and passes trimmed URL/alt through the injected port", async () => {
    const importFromUrl = vi.fn().mockResolvedValue({ media: { id: "new-media" } });
    renderDialog(importFromUrl);
    const dialog = document.querySelector(".jini-media-import-dialog") as HTMLElement;
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByLabelText("Remote image URL")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: " https://cdn.example/fox.png " } });
    fireEvent.change(screen.getByLabelText("Imported image alt text (optional)"), { target: { value: " A fox " } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(importFromUrl).toHaveBeenCalledWith({ url: "https://cdn.example/fox.png" }, { alt: "A fox" }));
    await waitFor(() => expect(screen.getByLabelText("Remote image URL")).toHaveValue(""));
    // Closes only after the successful import.
    expect(dialog).not.toHaveAttribute("open");
  });

  it("labels the submit Importing… and locks the fields while the import is in flight", async () => {
    let finish!: () => void;
    const importFromUrl = vi.fn(() => new Promise<Awaited<ReturnType<MediaImportPort["importFromUrl"]>>>((resolve) => {
      finish = () => resolve({ media: { id: "new-media" } as never });
    }));
    renderDialog(importFromUrl);
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: "https://cdn.example/fox.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(screen.getByLabelText("Remote image URL")).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Importing…" })).not.toBeInTheDocument());
  });

  it("keeps Import disabled until the URL meets the server's https-only, no-credentials contract", async () => {
    const importFromUrl = vi.fn();
    renderDialog(importFromUrl);
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    const submit = screen.getByRole("button", { name: "Import" });
    expect(submit).toBeDisabled();
    for (const bad of ["not a url", "http://cdn.example/fox.png", "https://user:pw@cdn.example/fox.png"]) {
      fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: bad } });
      expect(submit, bad).toBeDisabled();
      expect(screen.getByText("Enter an https:// image URL.")).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: "https://cdn.example/fox.png" } });
    expect(submit).toBeEnabled();
    expect(screen.queryByText("Enter an https:// image URL.")).toBeNull();
    fireEvent.submit(submit.closest("form")!);
    await waitFor(() => expect(importFromUrl).toHaveBeenCalledTimes(1));
  });

  it("shows a refused import inside the open dialog and keeps the URL for retry", async () => {
    const importFromUrl = vi.fn().mockRejectedValue(new Error("Target is not public"));
    renderDialog(importFromUrl);
    fireEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    fireEvent.change(screen.getByLabelText("Remote image URL"), { target: { value: "https://cdn.example/fox.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = document.querySelector(".jini-media-import-dialog") as HTMLElement;
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Target is not public");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByLabelText("Remote image URL")).toHaveValue("https://cdn.example/fox.png");
  });

  it("retains the draft and displays a refusal, then invalidates the media list after retry", async () => {
    const importFromUrl = vi.fn().mockRejectedValueOnce(new Error("Target is not public")).mockResolvedValue({ media: { id: "new-media" } });
    const list = vi.fn().mockResolvedValue({ media: [] });
    const { result } = renderHook(() => {
      useFetchQuery({ key: LIST_KEY, fetch: list });
      return useRemoteImageImport(hookArgs(importFromUrl));
    }, { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    act(() => { result.current.setUrl("https://cdn.example/fox.png"); });
    await act(() => result.current.submit());
    // The mutation's error state reaches observers on the adapter's notify batch, after the
    // rejected promise `submit` awaited, so wait for it rather than reading it synchronously.
    await waitFor(() => expect(result.current.error).toContain("Target is not public"));
    expect(result.current.url).toBe("https://cdn.example/fox.png");
    await act(() => result.current.submit());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeNull();
    expect(result.current.url).toBe("");
  });
});

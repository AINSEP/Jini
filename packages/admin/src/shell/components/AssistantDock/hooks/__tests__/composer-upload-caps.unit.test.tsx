// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../../../react/kit.js";
import { fakeAdminKit } from "../../../../../react/testing-kit.js";
import { useAttachmentUploader } from "../composer-files.hooks.js";

/** The hook builds the uploader through the kit's factory; a spy shows exactly which caps reach it. */
function mount(createDaemonAttachmentUploader: ReturnType<typeof vi.fn>, options: Parameters<typeof useAttachmentUploader>[1]) {
  const kit = fakeAdminKit({ chat: { createDaemonAttachmentUploader } as never });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AdminKitProvider, { kit, children });
  return renderHook(() => useAttachmentUploader({ fetch: vi.fn() as never }, options), { wrapper });
}

describe("useAttachmentUploader caps", () => {
  it("hands the host's per-file cap resolver to the uploader, so a video can exceed the image cap", () => {
    const factory = vi.fn(() => async () => []);
    const maxAttachmentBytesFor = (file: { type: string }) => (file.type.startsWith("video/") ? 500 : 50);
    mount(factory, { maxAttachmentBytes: 50, maxAttachmentBytesFor, maxBatchBytes: 100 });
    expect(factory).toHaveBeenCalledWith(expect.anything(), { maxAttachmentBytes: 50, maxAttachmentBytesFor, maxBatchBytes: 100 });
  });

  it("omits the resolver when the host passes none", () => {
    const factory = vi.fn(() => async () => []);
    mount(factory, { maxAttachmentBytes: 50 });
    expect(factory).toHaveBeenCalledWith(expect.anything(), { maxAttachmentBytes: 50 });
  });
});

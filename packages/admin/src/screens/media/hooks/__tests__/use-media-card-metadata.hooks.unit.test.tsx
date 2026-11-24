// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatByteSize } from "@jini-ai/core/text";
import { useMediaCardMetadata } from "../use-media-card-metadata.hooks.js";

describe("legacy media card metadata", () => {
  it("defaults to Jini's en-US size and UTC upload calendar date", () => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: 9_961_472, createdAt: "2026-10-03T23:30:00-02:00" },
    }));
    expect(result.current).toEqual({
      byteSize: "9.5 MB", uploadDate: "Oct 4, 2026",
      uploadDateTime: "2026-10-03T23:30:00-02:00", metadataSeparator: " · ", hasMetadata: true,
    });
  });

  it("forwards the card locale to both Jini formatters", () => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: 9_961_472, createdAt: "2026-10-04T00:00:00Z" },
    }, { locale: "de-DE" }));
    expect(result.current.byteSize).toBe("9,5 MB");
    expect(result.current.uploadDate).toBe("4. Okt. 2026");
  });

  it("keeps a zero-byte file and omits invalid dates and their separator", () => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: 0, createdAt: "invalid" },
    }));
    expect(result.current).toEqual({
      byteSize: "0 B", uploadDate: null, uploadDateTime: undefined, metadataSeparator: "", hasMetadata: true,
    });
  });

  it("does not invent a size for a legacy response", () => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { createdAt: "2026-10-04T00:00:00Z" },
    }));
    expect(result.current.byteSize).toBeNull();
    expect(result.current.uploadDate).toBe("Oct 4, 2026");
    expect(result.current.metadataSeparator).toBe("");
  });

  it("hides a null size from the blob store without calling the size formatter", () => {
    const size = vi.fn(() => "invented size");
    const date = vi.fn(() => "Oct 4, 2026");
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: null, createdAt: "2026-10-04T00:00:00Z" },
    }, { formatters: { formatByteSize: size, formatUploadDate: date } }));
    expect(size).not.toHaveBeenCalled();
    expect(result.current.byteSize).toBeNull();
    expect(result.current.uploadDate).toBe("Oct 4, 2026");
    expect(result.current.metadataSeparator).toBe("");
  });

  it("hides the line when neither value is available", () => {
    const { result } = renderHook(() => useMediaCardMetadata({ item: { createdAt: "" } }));
    expect(result.current.hasMetadata).toBe(false);
    expect(result.current.uploadDateTime).toBeUndefined();
  });

  it("delegates to injected ports and recomputes after the item changes", () => {
    const size = vi.fn(() => "size from Jini");
    const date = vi.fn(() => "date from Jini");
    const { result, rerender } = renderHook(({ bytes }) => useMediaCardMetadata({
      item: { byteSize: bytes, createdAt: "2026-10-04T00:00:00Z" },
    }, { locale: "fr-FR", formatters: { formatByteSize: size, formatUploadDate: date } }), {
      initialProps: { bytes: 1024 },
    });
    expect(size).toHaveBeenCalledWith({ bytes: 1024 }, { locale: "fr-FR" });
    expect(date).toHaveBeenCalledWith({ createdAt: "2026-10-04T00:00:00Z" }, { locale: "fr-FR" });
    expect(result.current.byteSize).toBe("size from Jini");
    expect(result.current.uploadDate).toBe("date from Jini");
    rerender({ bytes: 2048 });
    expect(size).toHaveBeenLastCalledWith({ bytes: 2048 }, { locale: "fr-FR" });
  });

  it("remains importable against the old built Jini barrel without duplicating date logic", () => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: 1024, createdAt: "2026-10-04T00:00:00Z" },
    }, { formatters: { formatByteSize } }));
    expect(result.current.byteSize).toBe("1 KB");
    expect(result.current.uploadDate).toBeNull();
    expect(result.current.metadataSeparator).toBe("");
  });

  it.each([
    { size: "size", date: "date", separator: " · ", dateTime: "original", visible: true },
    { size: "size", date: null, separator: "", dateTime: undefined, visible: true },
    { size: "", date: "date", separator: "", dateTime: "original", visible: true },
    { size: "size", date: "", separator: "", dateTime: undefined, visible: true },
    { size: "", date: "", separator: "", dateTime: undefined, visible: true },
  ])("preserves presentation for size '$size' and date '$date'", ({ size, date, separator, dateTime, visible }) => {
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize: 0, createdAt: "original" },
    }, { formatters: { formatByteSize: () => size, formatUploadDate: () => date } }));
    expect(result.current).toEqual({
      byteSize: size, uploadDate: date, uploadDateTime: dateTime,
      metadataSeparator: separator, hasMetadata: visible,
    });
  });

  it.each([null, undefined])("skips formatting a %s byte size when the date port is absent", (byteSize) => {
    const size = vi.fn(() => "size");
    const { result } = renderHook(() => useMediaCardMetadata({
      item: { byteSize, createdAt: "original" },
    }, { formatters: { formatByteSize: size } }));
    expect(size).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      byteSize: null, uploadDate: null, uploadDateTime: undefined,
      metadataSeparator: "", hasMetadata: false,
    });
  });
});

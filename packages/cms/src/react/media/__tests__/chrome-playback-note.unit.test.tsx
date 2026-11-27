import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { ChromePlaybackNote } from "../chrome-playback-note.js";

type Media = ComponentProps<typeof ChromePlaybackNote>["item"];

it("shows the translated warning for an HEVC upload exactly at the unconverted size limit", () => {
  const t = vi.fn((key: string) => key === "This video may not play in Chrome." ? "Chrome risque de ne pas lire cette vidéo." : key);
  render(<ChromePlaybackNote t={t} item={{ videoCodec: "hevc", byteSize: 1024 }} maxUploadBytes={1024} />);

  expect(screen.getByText("Chrome risque de ne pas lire cette vidéo.")).toBeVisible();
  expect(t.mock.calls).toEqual([["This video may not play in Chrome."]]);
});

const compatible: Array<{ reason: string; item: Media }> = [
  { reason: "H.264 video", item: { videoCodec: "h264", byteSize: 1024 } },
  { reason: "HEVC video above the conversion threshold", item: { videoCodec: "hevc", byteSize: 1025 } },
  { reason: "HEVC video with an unknown byte size", item: { videoCodec: "hevc", byteSize: null } },
];

it.each(compatible)("does not show a Chrome warning for $reason", ({ item }) => {
  const { container } = render(<ChromePlaybackNote t={(key) => key} item={item} maxUploadBytes={1024} />);

  expect(container).toBeEmptyDOMElement();
});

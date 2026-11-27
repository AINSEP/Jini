// @vitest-environment jsdom
import { expect, it } from "vitest";
import { pagePreviewYoutubeIds } from "../lib/page-preview-youtube.js";

it("extracts videos from nested document nodes and iframe embeds, preserving order and deduplicating", () => {
  expect(pagePreviewYoutubeIds({
    html: '<iframe src="https://www.youtube-nocookie.com/embed/first_id"></iframe><iframe src="https://youtu.be/html-short"></iframe>',
    bodyJson: { type: "doc", content: [null, 8, {
      type: "section", content: [
        { type: "not-youtube", attrs: { src: "https://youtu.be/skip-other-type" } },
        { type: "youtube", attrs: null },
        { type: "youtube", attrs: "https://youtu.be/skip-invalid-attrs" },
        { type: "youtube", attrs: {} },
        { type: "youtube", attrs: { src: 198 } },
        { type: "youtube", attrs: { src: "https://youtu.be/short-2?t=9" } },
        { type: "youtube", attrs: { src: "https://www.youtube.com/watch?v=watch_3" } },
        { type: "youtube", attrs: { src: "https://youtube.com/shorts/shorts_4" } },
        { type: "youtube", attrs: { src: "https://youtube.com/embed/first_id" } },
      ],
    }] },
  })).toEqual(["first_id", "short-2", "watch_3", "shorts_4"]);
});

it.each([
  ["https://www.youtube.com.evil.test/watch?v=valid_id", []],
  ["http://www.youtube.com/watch?v=valid_id", []],
  ["https://user:pass@www.youtube.com/watch?v=valid_id", []],
  ["https://www.youtube.com/watch?v=bad%20id", []],
  ["https://www.youtube.com/watch", []],
  ["https://www.youtube.com/watch?v=", []],
  ["https://youtu.be/valid/extra", []],
  ["https://youtu.be/" + "a".repeat(33), []],
  ["https://youtu.be/" + "a".repeat(32), ["a".repeat(32)]],
  ["/embed/valid_id", []],
])("validates the video source %s independently", (src, ids) => {
  expect(pagePreviewYoutubeIds({ html: "", bodyJson: { type: "youtube", attrs: { src } } })).toEqual(ids);
});

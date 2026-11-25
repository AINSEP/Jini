import { useLayoutEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePostUrlDialog, type PostUrlEditorPort } from "../use-post-url-dialog.hooks.js";

afterEach(cleanup);

test("URL guards precede the YouTube parser, original URLs reach commands and cleanup precedes final focus", () => {
  const order: string[] = [];
  const setImage = vi.fn();
  const setYoutubeVideo = vi.fn();
  const chain: ReturnType<PostUrlEditorPort["chain"]> = { focus: () => { order.push("focus"); return chain; }, extendMarkRange: () => chain, unsetLink: () => chain, setLink: () => chain, setImage: input => { setImage(input); return chain; }, setYoutubeVideo: input => { setYoutubeVideo(input); return chain; }, run: () => true };
  const editor: PostUrlEditorPort = { isActive: () => false, chain: () => chain };
  const parser = vi.fn<(input: { url: string }) => string | null>(({ url }) => url === "https://example.com/refused-video" ? null : "https://embed.example/video");
  const frames: Array<() => void> = [];
  const scheduler = (close: () => void) => { frames.push(close); };
  let live: ReturnType<typeof usePostUrlDialog> | undefined;
  function Dialog() { useLayoutEffect(() => () => { order.push("opener cleanup"); }, []); return null; }
  function Probe() { live = usePostUrlDialog({ editor, getEmbedUrlFromYoutubeUrl: parser }, { afterEditorFocus: scheduler }); return live.open ? <Dialog /> : null; }
  render(<Probe />);
  const controller = () => { if (!live) throw new Error("not mounted"); return live; };
  const opener = document.createElement("button");
  act(() => controller().openYoutube({ currentTarget: opener }));
  act(() => controller().changeUrl({ value: "javascript:alert(1)" }));
  act(() => controller().submit({ preventDefault() {} }));
  expect(controller().error).toBe("Enter an HTTP or HTTPS URL.");
  expect(parser).not.toHaveBeenCalled();
  expect(setYoutubeVideo).not.toHaveBeenCalled();
  act(() => controller().changeUrl({ value: "https://example.com/refused-video" }));
  act(() => controller().submit({ preventDefault() {} }));
  expect(controller().error).toBe("Enter a supported YouTube URL.");
  expect(setYoutubeVideo).not.toHaveBeenCalled();
  act(() => controller().changeUrl({ value: "https://youtube.com/watch?v=original" }));
  act(() => controller().submit({ preventDefault() {} }));
  expect(setYoutubeVideo).toHaveBeenCalledWith({ src: "https://youtube.com/watch?v=original" });
  expect(controller().open).toBe(true);
  order.length = 0;
  act(() => frames.shift()?.());
  expect(order).toEqual(["opener cleanup", "focus"]);
  act(() => controller().openImage({ currentTarget: opener }));
  act(() => controller().changeUrl({ value: "https://example.com/image" }));
  act(() => controller().submit({ preventDefault() {} }));
  expect(setImage).toHaveBeenCalledWith({ src: "https://example.com/image" });
  expect(Object.hasOwn(setImage.mock.calls[0]?.[0] ?? {}, "alt")).toBe(false);
  act(() => frames.shift()?.());
});

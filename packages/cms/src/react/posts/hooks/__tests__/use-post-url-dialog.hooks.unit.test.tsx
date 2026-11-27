import { useLayoutEffect } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
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

test("link actions remove an existing mark or insert one valid URL, and reject malformed hosts", () => {
  const applied: string[] = [];
  let href: string | null = "https://example.test/old";
  let nextHref: string | null | undefined;
  const chain: ReturnType<PostUrlEditorPort["chain"]> = {
    focus: () => chain, extendMarkRange: (name) => { expect(name).toBe("link"); return chain; },
    unsetLink: () => { nextHref = null; return chain; },
    setLink: ({ href }) => { nextHref = href; return chain; },
    setImage: () => { throw new Error("not an image operation"); },
    setYoutubeVideo: () => { throw new Error("not a video operation"); },
    run: () => {
      if (nextHref !== undefined) {
        href = nextHref;
        applied.push(nextHref === null ? "unlink" : nextHref);
      }
      nextHref = undefined;
      return true;
    },
  };
  const editor = { isActive: (name: string) => name === "link" && href !== null, chain: () => chain };
  const frames: (() => void)[] = [];
  const { result, rerender } = renderHook(({ live }: { live: PostUrlEditorPort | null }) =>
    usePostUrlDialog({ editor: live, getEmbedUrlFromYoutubeUrl: () => null }, { afterEditorFocus: close => frames.push(close) }),
  { initialProps: { live: null } });
  const opener = document.createElement("button");
  act(() => result.current.openLink({ currentTarget: opener }));
  expect(result.current.open).toBe(false);
  expect(href).toBe("https://example.test/old");
  rerender({ live: editor });
  act(() => result.current.openLink({ currentTarget: opener }));
  expect(applied).toEqual(["unlink"]);
  expect(href).toBeNull();
  expect(result.current.open).toBe(false);
  act(() => result.current.openLink({ currentTarget: opener }));
  expect(result.current.title).toBe("Link URL");
  expect(result.current.url).toBe("https://");
  act(() => result.current.changeUrl({ value: "https://?empty-host" }));
  act(() => result.current.submit({ preventDefault() {} }));
  expect(result.current.error).toBe("Enter an HTTP or HTTPS URL.");
  expect(applied).toEqual(["unlink"]);
  expect(frames).toHaveLength(0);
  act(() => result.current.changeUrl({ value: "https://example.test/new?q=1" }));
  act(() => result.current.submit({ preventDefault() {} }));
  act(() => result.current.submit({ preventDefault() {} }));
  expect(href).toBe("https://example.test/new?q=1");
  expect(applied).toEqual(["unlink", "https://example.test/new?q=1"]);
  expect(frames).toHaveLength(1);
  act(() => frames[0]!());
  expect(result.current.open).toBe(false);
  expect(result.current.pending).toBe(false);
});

test("image submit forwards authored alt text as well as its URL", () => {
  const images: { src: string; alt?: string }[] = [];
  const chain: ReturnType<PostUrlEditorPort["chain"]> = {
    focus: () => chain, extendMarkRange: () => chain, unsetLink: () => chain, setLink: () => chain,
    setImage: (image) => { images.push(image); return chain; }, setYoutubeVideo: () => chain, run: () => true,
  };
  const { result } = renderHook(() => usePostUrlDialog({ editor: { isActive: () => false, chain: () => chain }, getEmbedUrlFromYoutubeUrl: () => null },
    { afterEditorFocus: close => close() }));
  act(() => result.current.openImage({ currentTarget: document.createElement("button") }));
  act(() => result.current.changeUrl({ value: "https://example.test/bike.png" }));
  act(() => result.current.changeAlt({ value: "A blue bicycle" }));
  act(() => result.current.submit({ preventDefault() {} }));
  expect(images).toEqual([{ src: "https://example.test/bike.png", alt: "A blue bicycle" }]);
  expect(result.current.open).toBe(false);
});

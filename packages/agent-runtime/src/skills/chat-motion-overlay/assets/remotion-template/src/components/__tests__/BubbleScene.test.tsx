import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {ReactElement, ReactNode} from "react";
import type {ChatSpec} from "../types";

// The template ships its own package.json (react 19, remotion 4) and is not a
// workspace member, so "react" is unresolvable from here. Resolve the copy the
// pnpm store already holds (its hidden hoist dir `node_modules/.pnpm/node_modules`)
// and route the template's imports to it; remotion is replaced by typed fakes.
const deps = vi.hoisted(async () => {
  const {createRequire} = await import("node:module");
  const anchor = new URL("../../../../../../../../../../node_modules/.pnpm/anchor.js", import.meta.url);
  const require = createRequire(anchor);
  return {
    react: require.resolve("react"),
    jsxRuntime: require.resolve("react/jsx-runtime"),
    jsxDevRuntime: require.resolve("react/jsx-dev-runtime"),
    server: require.resolve("react-dom/server"),
  };
});

const frameState = vi.hoisted(() => ({frame: 0}));

vi.mock("react", async () => import((await deps).react));
vi.mock("react/jsx-runtime", async () => import((await deps).jsxRuntime));
vi.mock("react/jsx-dev-runtime", async () => import((await deps).jsxDevRuntime));

vi.mock("remotion", () => {
  type InterpolateOptions = {extrapolateRight?: "clamp" | "extend"};
  type SpringArgs = {frame: number; fps: number; durationInFrames?: number};
  type ImgProps = {src: string; style?: Record<string, string | number>};
  // Linear two-point interpolation that clamps on the right, matching how
  // BubbleScene calls remotion's interpolate.
  const interpolate = (
    input: number,
    inputRange: readonly [number, number],
    outputRange: readonly [number, number],
    options: InterpolateOptions = {},
  ): number => {
    const [inStart, inEnd] = inputRange;
    const [outStart, outEnd] = outputRange;
    const clamped = options.extrapolateRight === "clamp" ? Math.min(input, inEnd) : input;
    return outStart + ((clamped - inStart) / (inEnd - inStart)) * (outEnd - outStart);
  };
  const spring = ({frame, durationInFrames = 1}: SpringArgs): number => Math.min(1, frame / durationInFrames);
  const Img = ({src, style}: ImgProps): ReactElement => <img src={src} style={style} />;
  return {
    interpolate,
    spring,
    useCurrentFrame: (): number => frameState.frame,
    useVideoConfig: (): {fps: number} => ({fps: 30}),
    staticFile: (path: string): string => `/static/${path}`,
    Img,
  };
});

type Message = ChatSpec["messages"][number];
type Participant = ChatSpec["participants"][number];
type SceneConfig = ChatSpec["sceneConfig"];

const alice: Participant = {id: "a", name: "Alice", side: "left", avatarKey: "female-cat-orange"};
const bob: Participant = {id: "b", name: "Bob", side: "right", avatarKey: "male-bear-mint"};

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  speaker: "Alice",
  text: "hi",
  side: "left",
  avatarKey: "female-cat-orange",
  appearAt: 0,
  ...overrides,
});

const spec = (overrides: {sceneConfig?: Partial<SceneConfig>; messages?: Message[]} = {}): ChatSpec => ({
  title: "Group Chat",
  timestamp: "10:24",
  durationInFrames: 120,
  timing: {start: 0, gap: 10, hold: 30},
  sceneConfig: {
    container: "wechat",
    avatarMode: "preset",
    deviceFrame: "none",
    nicknameMode: "hidden",
    deliveryFormat: "preview",
    output: "preview-only",
    showTimestamp: true,
    ...overrides.sceneConfig,
  },
  participants: [alice, bob],
  messages: overrides.messages ?? [message()],
});

const render = async (chatSpec: ChatSpec, frame = 100): Promise<string> => {
  frameState.frame = frame;
  const {renderToStaticMarkup} = (await import((await deps).server)) as {
    renderToStaticMarkup: (node: ReactNode) => string;
  };
  const {createElement} = (await import("react")) as typeof import("react");
  const {BubbleScene} = await import("../BubbleScene");
  return renderToStaticMarkup(createElement(BubbleScene, {chatSpec}));
};

/** The bubble element's inline style (the one carrying the message text's font). */
const bubbleStyle = (html: string): string => {
  const match = /<div style="(background:[^"]*)">/.exec(html);
  if (!match) throw new Error(`no bubble in ${html}`);
  return match[1];
};

describe("BubbleScene container chrome", () => {
  it("renders the transparent 1080x1920 canvas with no header when container is none", async () => {
    const html = await render(spec({sceneConfig: {container: "none"}}));
    expect(html).toContain('<div style="width:1080px;height:1920px;display:flex;flex-direction:column;background:transparent">');
    expect(html).not.toContain("Group Chat");
    expect(html).toContain('<div style="padding:180px 92px;flex:1;width:100%">');
  });

  it("renders the themed full-size screen with the title header when a container is set", async () => {
    const html = await render(spec({sceneConfig: {container: "telegram"}}));
    expect(html).toContain("width:100%;height:100%;background:#DDE8F6;display:flex;flex-direction:column;");
    expect(html).toContain("height:132px;background:#F5F8FC;");
    expect(html).toContain(">Group Chat</div>");
    expect(html).toContain('<div style="padding:0 22px;flex:1;width:100%">');
  });

  it("uses the shared bubble font stack on the container screen", async () => {
    const html = await render(spec());
    expect(html).toContain(
      "font-family:&quot;PingFang SC&quot;, &quot;Alibaba PuHuiTi&quot;, &quot;Noto Sans SC&quot;, sans-serif;overflow:hidden",
    );
  });

  it("shows the timestamp in the theme subtitle colour when showTimestamp is true", async () => {
    const html = await render(spec({sceneConfig: {container: "wechat", showTimestamp: true}}));
    expect(html).toContain("color:#9A9A9A;font-size:22px;font-weight:500;opacity:1\">10:24</div>");
  });

  it("omits the timestamp when showTimestamp is false", async () => {
    const html = await render(spec({sceneConfig: {showTimestamp: false}}));
    expect(html).not.toContain("10:24");
  });

  it("fades the header in over the first 12 frames", async () => {
    const html = await render(spec(), 6);
    expect(html).toContain("padding:0 22px 14px;opacity:0.5;flex-shrink:0");
  });
});

describe("BubbleScene message list", () => {
  it("renders a hidden placeholder for a message whose appearAt is still in the future", async () => {
    const html = await render(spec({messages: [message({appearAt: 50})]}), 49);
    expect(html).toContain('<div style="display:none"></div>');
    expect(html).not.toContain(">hi</div>");
  });

  it("skips a message whose speaker is not a participant", async () => {
    const html = await render(spec({messages: [message({speaker: "Mallory", text: "ghost"})]}));
    expect(html).not.toContain("ghost");
    expect(html).not.toContain("display:none");
  });

  it("renders a left message flex-start with the left bubble colour and dark text", async () => {
    const html = await render(spec());
    expect(html).toContain("justify-content:flex-start");
    expect(html).toContain("flex-direction:row;max-width:86%");
    expect(bubbleStyle(html)).toContain("background:#FFFFFF;");
    expect(bubbleStyle(html)).toContain("color:#1F1F1F;");
    expect(bubbleStyle(html)).toContain("transform-origin:left center");
  });

  it("renders a right message flex-end with the right bubble colour", async () => {
    const html = await render(spec({messages: [message({speaker: "Bob", side: "right"})]}));
    expect(html).toContain("justify-content:flex-end");
    expect(html).toContain("flex-direction:row-reverse;max-width:86%");
    expect(bubbleStyle(html)).toContain("background:#95EC69;");
    expect(bubbleStyle(html)).toContain("transform-origin:right center");
  });

  it("uses white text for a right bubble in the messenger container", async () => {
    const html = await render(spec({sceneConfig: {container: "messenger"}, messages: [message({side: "right"})]}));
    expect(bubbleStyle(html)).toContain("color:#FFFFFF;");
  });

  it("keeps dark text for a left bubble in the messenger container", async () => {
    const html = await render(spec({sceneConfig: {container: "messenger"}}));
    expect(bubbleStyle(html)).toContain("color:#1F1F1F;");
  });

  it("applies the highlight shadow and border to a highlighted message", async () => {
    const html = await render(spec({messages: [message({highlight: true})]}));
    expect(bubbleStyle(html)).toContain(
      "box-shadow:0 8px 26px rgba(236,135,120,0.18);border:2px solid rgba(235,135,120,0.45);",
    );
  });

  it("applies the plain shadow and border to a normal message", async () => {
    const html = await render(spec());
    expect(bubbleStyle(html)).toContain("box-shadow:0 2px 6px rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.04);");
  });

  it("slides a left bubble in from -26px and fades it in at its first frame", async () => {
    const html = await render(spec({messages: [message({appearAt: 10})]}), 10);
    expect(html).toContain("margin-bottom:14px;opacity:0;");
    expect(bubbleStyle(html)).toContain("transform:translateX(-26px) scale(0)");
  });

  it("slides a right bubble in from +26px", async () => {
    const html = await render(spec({messages: [message({speaker: "Bob", side: "right", appearAt: 10})]}), 10);
    expect(bubbleStyle(html)).toContain("transform:translateX(26px) scale(0)");
  });

  it("settles the bubble at its resting transform once the animation is done", async () => {
    const html = await render(spec(), 100);
    expect(html).toContain("margin-bottom:14px;opacity:1;");
    expect(bubbleStyle(html)).toContain("transform:translateX(0px) scale(1)");
  });

  it("renders the participant avatar from its preset file", async () => {
    const html = await render(spec());
    expect(html).toContain('<img src="/static/female-cat-orange.png"');
  });
});

describe("BubbleScene nicknames", () => {
  const twoFromAlice = [message({id: "m1", text: "one"}), message({id: "m2", text: "two"})];
  const names = (html: string): number => html.split(">Alice</div>").length - 1;

  it("shows the speaker name on every message in always mode", async () => {
    expect(names(await render(spec({sceneConfig: {nicknameMode: "always"}, messages: twoFromAlice})))).toBe(2);
  });

  it("shows the speaker name only on the first message in first-message-only mode", async () => {
    expect(names(await render(spec({sceneConfig: {nicknameMode: "first-message-only"}, messages: twoFromAlice})))).toBe(1);
  });

  it("never shows the speaker name in hidden mode", async () => {
    expect(names(await render(spec({sceneConfig: {nicknameMode: "hidden"}, messages: twoFromAlice})))).toBe(0);
  });
});

describe("BubbleScene text measurement without a DOM", () => {
  it("sizes a short latin message from the estimated glyph widths and keeps it on one line", async () => {
    // "a b": 2 latin chars at 17.4 + one space at 10.5 = 45.3; +18 safety +44 padding = 107.3 -> 108.
    const style = bubbleStyle(await render(spec({messages: [message({text: "a b"})]})));
    expect(style).toContain("width:108px;");
    expect(style).toContain("white-space:nowrap;");
  });

  it("estimates a CJK character at 1.02em", async () => {
    // 30.6 + 18 + 44 = 92.6 -> 93.
    expect(bubbleStyle(await render(spec({messages: [message({text: "你"})]})))).toContain("width:93px;");
  });

  it("wraps a paragraph wider than the row onto several lines and caps the bubble width", async () => {
    // wechat: (780-44)*0.86 - 62 - 12 - 44 = 514.96 max text width; 17.4px per latin char -> 29 chars per line.
    const text = "x".repeat(40);
    const html = await render(spec({messages: [message({text})]}));
    expect(html).toContain(`>${"x".repeat(29)}\n${"x".repeat(11)}</div>`);
    expect(bubbleStyle(html)).toContain("width:559px;");
    expect(bubbleStyle(html)).toContain("white-space:pre-wrap;");
  });

  it("uses the narrower row of the none container when wrapping", async () => {
    // none: (780-184)*0.86 - 118 = 394.56 -> 22 latin chars per line.
    const html = await render(spec({sceneConfig: {container: "none"}, messages: [message({text: "x".repeat(30)})]}));
    expect(html).toContain(`>${"x".repeat(22)}\n${"x".repeat(8)}</div>`);
  });

  it("keeps explicit newlines, blank lines and short paragraphs as-is and sizes by the widest line", async () => {
    // widest line "abcd" = 69.6; +18 +44 = 131.6 -> 132.
    const html = await render(spec({messages: [message({text: "ab\n\nabcd"})]}));
    expect(html).toContain(">ab\n\nabcd</div>");
    expect(bubbleStyle(html)).toContain("width:132px;");
    expect(bubbleStyle(html)).toContain("white-space:pre-wrap;");
  });

  it("renders an empty message as a padding-only bubble", async () => {
    expect(bubbleStyle(await render(spec({messages: [message({text: ""})]})))).toContain("width:62px;");
  });

  it("keeps a line whose width plus safety margin stays within the row on one line", async () => {
    // 28 latin chars = 487.2; +18 = 505.2 <= 514.96.
    expect(bubbleStyle(await render(spec({messages: [message({text: "x".repeat(28)})]})))).toContain("white-space:nowrap;");
  });

  it("pre-wraps an unwrapped line that only overflows once the safety margin is added, capping its width", async () => {
    // 29 latin chars = 504.6 <= 514.96 (no wrap) but 504.6 + 18 > 514.96; width = 514.96 + 44 -> 559.
    const html = await render(spec({messages: [message({text: "x".repeat(29)})]}));
    expect(html).toContain(`>${"x".repeat(29)}</div>`);
    expect(bubbleStyle(html)).toContain("white-space:pre-wrap;");
    expect(bubbleStyle(html)).toContain("width:559px;");
  });
});

type FakeContext = {font: string; measureText: (text: string) => {width: number}};
type FakeCanvas = {getContext: (kind: "2d") => FakeContext | null};
type FakeWindow = Record<string, FakeCanvas | undefined>;
type FakeDocument = {defaultView: FakeWindow | null; createElement: (tag: "canvas") => FakeCanvas};

describe("BubbleScene text measurement with a DOM", () => {
  const CACHE_KEY = "__chat_motion_overlay_measure_canvas__";
  let fonts: string[];

  const fakeDocument = (view: FakeWindow | null, context: FakeContext | null): FakeDocument => ({
    defaultView: view,
    createElement: vi.fn((): FakeCanvas => ({getContext: () => context})),
  });

  const measuringContext = (): FakeContext => {
    const context: FakeContext = {
      font: "",
      measureText: (text: string) => {
        fonts.push(context.font);
        return {width: text.length * 10};
      },
    };
    return context;
  };

  beforeEach(() => {
    fonts = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("measures text with the canvas 2d context at the bubble font", async () => {
    vi.stubGlobal("document", fakeDocument({}, measuringContext()));
    // "abc" = 30 + 18 + 44 = 92.
    expect(bubbleStyle(await render(spec({messages: [message({text: "abc"})]})))).toContain("width:92px;");
    expect(fonts[0]).toBe('500 30px "PingFang SC", "Alibaba PuHuiTi", "Noto Sans SC", sans-serif');
  });

  it("creates the measuring canvas once and caches it on the window", async () => {
    const view: FakeWindow = {};
    const doc = fakeDocument(view, measuringContext());
    vi.stubGlobal("document", doc);
    await render(spec({messages: [message({text: "abc"})]}));
    expect(doc.createElement).toHaveBeenCalledTimes(1);
    expect(view[CACHE_KEY]).toBeDefined();
  });

  it("reuses a canvas already cached on the window", async () => {
    const cached: FakeCanvas = {getContext: () => measuringContext()};
    const doc = fakeDocument({[CACHE_KEY]: cached}, null);
    vi.stubGlobal("document", doc);
    expect(bubbleStyle(await render(spec({messages: [message({text: "abc"})]})))).toContain("width:92px;");
    expect(doc.createElement).toHaveBeenCalledTimes(0);
  });

  it("falls back to the glyph estimate when the document has no window", async () => {
    vi.stubGlobal("document", fakeDocument(null, measuringContext()));
    expect(bubbleStyle(await render(spec({messages: [message({text: "a b"})]})))).toContain("width:108px;");
    expect(fonts).toEqual([]);
  });

  it("falls back to the glyph estimate when the canvas has no 2d context", async () => {
    vi.stubGlobal("document", fakeDocument({}, null));
    expect(bubbleStyle(await render(spec({messages: [message({text: "a b"})]})))).toContain("width:108px;");
  });
});

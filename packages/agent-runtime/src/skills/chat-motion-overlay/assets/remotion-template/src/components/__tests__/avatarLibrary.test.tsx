import {describe, expect, it, vi} from "vitest";
import type {ChatSpec} from "../types";

// Same in-place harness as BubbleScene.test.tsx: the template is not a workspace member, so
// "react" resolves to the copy in the pnpm store's hoist dir and remotion is a typed fake. Only
// `staticFile` matters here; it is faked as a visible `/static/` prefix so the chosen path shows.
const deps = vi.hoisted(async () => {
  const {createRequire} = await import("node:module");
  const anchor = new URL("../../../../../../../../../../node_modules/.pnpm/anchor.js", import.meta.url);
  const require = createRequire(anchor);
  return {
    react: require.resolve("react"),
    jsxRuntime: require.resolve("react/jsx-runtime"),
    jsxDevRuntime: require.resolve("react/jsx-dev-runtime"),
  };
});

vi.mock("react", async () => import((await deps).react));
vi.mock("react/jsx-runtime", async () => import((await deps).jsxRuntime));
vi.mock("react/jsx-dev-runtime", async () => import((await deps).jsxDevRuntime));
vi.mock("remotion", () => ({
  staticFile: (path: string): string => `/static/${path}`,
  Img: (): null => null,
}));

type Participant = ChatSpec["participants"][number];

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: "a",
  name: "Alice",
  side: "left",
  avatarKey: "male-koala-lilac",
  ...overrides,
});

describe("avatarSrcFor", () => {
  it("serves a participant's uploaded avatar ahead of any preset", async () => {
    const {avatarSrcFor} = await import("../avatarLibrary");
    expect(avatarSrcFor(participant({uploadAsset: "uploads/alice.png"}))).toBe("/static/uploads/alice.png");
  });

  it("serves the preset file for a known avatar key when nothing was uploaded", async () => {
    const {avatarSrcFor} = await import("../avatarLibrary");
    expect(avatarSrcFor(participant({uploadAsset: null}))).toBe("/static/male-koala-lilac.png");
  });

  it("falls back to the default preset for an avatar key the library does not ship", async () => {
    const {avatarSrcFor} = await import("../avatarLibrary");
    expect(avatarSrcFor(participant({avatarKey: "dragon-red"}))).toBe("/static/female-bunny-pink.png");
  });
});

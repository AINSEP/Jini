import { expect, test } from "vitest";
import { postPublicPath } from "../public-path.js";

test("the root slug is the public root while a real home slug keeps its public path", () => {
  expect(postPublicPath({ slug: "/" })).toBe("/");
  expect(postPublicPath({ slug: "home" })).toBe("/home");
  expect(postPublicPath({ slug: "authored" })).toBe("/authored");
});

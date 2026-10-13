import { expect, it } from "vitest";
import { mimeForTransformFormat } from "../transform-format.js";
import { mimeForTransformFormat as mediaMimeForTransformFormat } from "../../media/transform-types.js";

it.each([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
] as const)("preserves the rendition MIME for %s through the media compatibility export", (format, mime) => {
  expect(mimeForTransformFormat({ format })).toBe(mime);
  expect(mediaMimeForTransformFormat).toBe(mimeForTransformFormat);
});

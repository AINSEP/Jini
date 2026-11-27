import { expect, it, vi } from "vitest";
import { createMediaImageReplace, createMediaImageTranslator } from "../media-image-extension.hooks.js";

it("binds each requested image label to the editor locale", () => {
  const translate = vi.fn(({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`);
  const t = createMediaImageTranslator({ locale: "de", translate });
  expect(t({ key: "Replace image" })).toBe("de:Replace image");
  expect(t({ key: "Remove image" })).toBe("de:Remove image");
  expect(translate.mock.calls).toEqual([[{ locale: "de", key: "Replace image" }], [{ locale: "de", key: "Remove image" }]]);
});

it.each([["", "Portrait title"], ["Profile photo", "Profile photo"]])("clears legacy image fields after picking alt %j", (alt, expected) => {
  let attrs: Record<string, unknown> = { src: "/legacy/image", title: "Old title", alt: "Old label", alignment: "left" };
  let picking = true;
  const replace = createMediaImageReplace({
    props: { updateAttributes: (patch) => { attrs = { ...attrs, ...patch }; } },
    setPicking: (value) => { picking = value; },
  });
  replace({ id: "image-2", alt, title: "Portrait title" });
  expect(attrs).toEqual({ assetId: "image-2", transformName: "public", alt: expected, src: null, title: null, alignment: "left" });
  expect(picking).toBe(false);
});

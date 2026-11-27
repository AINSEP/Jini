// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useAdminDocumentLocale } from "../use-admin-document-locale.hooks.js";

it("sets the full language tag and follows base-language direction on a host root", () => {
  const root = document.createElement("section");
  const { rerender } = renderHook(({ locale }) => useAdminDocumentLocale({ locale }, { root }), { initialProps: { locale: "AR-EG" } });
  expect(root.lang).toBe("AR-EG");
  expect(root.dir).toBe("rtl");
  rerender({ locale: "he-IL" });
  expect(root.lang).toBe("he-IL");
  expect(root.dir).toBe("rtl");
  rerender({ locale: "en-GB" });
  expect(root.lang).toBe("en-GB");
  expect(root.dir).toBe("ltr");
});

it("updates the document root when the host supplies no root", () => {
  const root = document.documentElement;
  const previous = { lang: root.lang, dir: root.dir };
  try {
    renderHook(() => useAdminDocumentLocale({ locale: "fa" }));
    expect(root.lang).toBe("fa");
    expect(root.dir).toBe("rtl");
  } finally { Object.assign(root, previous); }
});

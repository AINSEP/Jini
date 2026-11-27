// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { realEmbedPolicy } from "../../../../media/__tests__/fakes/embed-policy.js";
import { useMediaEditDialog } from "../MediaEditDialog.hooks.js";

const dependencies: Parameters<typeof useMediaEditDialog>[0]["deps"] = {
  locale: "fr",
  translate: ({ key, locale }) => `${locale}:${key}`,
  describeHtmlAttributeError: ({ error, locale }) => `${locale}:${error.reason}:${error.attribute}`,
  htmlAttributePolicy: realEmbedPolicy,
};

it("starts unset fields empty, localizes the hint and forwards a save even with an invalid attribute", () => {
  const onSave = vi.fn();
  const { result } = renderHook(() => useMediaEditDialog({
    initial: { alt: null, cssClass: null, htmlAttributes: null }, onSave, _onCancel: vi.fn(), deps: dependencies,
  }));
  expect([result.current.alt, result.current.cssClass, result.current.htmlAttributes, result.current.htmlAttributesError]).toEqual(["", "", "", null]);
  expect(result.current.t({ key: "Edit media" })).toBe("fr:Edit media");
  act(() => {
    result.current.setAlt("Canal at sunset");
    result.current.setCssClass("wide");
    result.current.setHtmlAttributes('onclick="noop"');
  });
  expect(result.current.htmlAttributesError).toBe("fr:event-handler:onclick");
  act(() => result.current.save());
  expect(onSave.mock.calls).toEqual([[{ alt: "Canal at sunset", cssClass: "wide", htmlAttributes: 'onclick="noop"' }]]);
});

it("clears three previously saved fields when their drafts contain only whitespace", () => {
  const onSave = vi.fn();
  const { result } = renderHook(() => useMediaEditDialog({
    initial: { alt: "Canal", cssClass: "wide", htmlAttributes: 'aria-label="Old"' }, onSave,
    _onCancel: vi.fn(), deps: dependencies,
  }));
  expect([result.current.alt, result.current.cssClass, result.current.htmlAttributes]).toEqual(["Canal", "wide", 'aria-label="Old"']);
  act(() => {
    result.current.setAlt(" ");
    result.current.setCssClass("\t");
    result.current.setHtmlAttributes("\n");
  });
  expect(result.current.htmlAttributesError).toBeNull();
  act(() => result.current.save());
  expect(onSave.mock.calls).toEqual([[{ alt: null, cssClass: null, htmlAttributes: null }]]);
});

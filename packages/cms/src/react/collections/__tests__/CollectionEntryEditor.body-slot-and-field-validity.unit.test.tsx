// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CollectionEntryEditor, type CollectionEntryEditorProps } from "../CollectionEntryEditor.js";

it("keeps the body opaque, gates invalid JSON and renders taxonomy only for saved entries", () => {
  const BodyEditor = vi.fn(({ editor }: { editor: { opaque: string } }) => <div>{editor.opaque}</div>);
  const EntryTerms = vi.fn((_props: { contentType: string; contentId: string }) => <div>taxonomy</div>);
  const editor = { opaque: "body slot" };
  const props: CollectionEntryEditorProps<typeof editor> = {
    contentTypeKey: "catalog", entryId: null, BodyEditor, EntryTerms, ServerLabel: ({ value }) => <span>{value}</span>, entryListHref: ({ contentTypeKey }) => `/entries/${contentTypeKey}`, readStoredField: () => ({ saved: true }),
    useCollectionEntryEditorHook: ({ entryId }) => {
      const [invalid, setInvalid] = useState(false);
      return { contentType: { label: "Catalog", fields: [{ name: "metadata", kind: "json", required: false, queryable: false }] }, entry: entryId ? { id: entryId, slug: "saved", status: "draft" } : null, title: "", setTitle: vi.fn(), slug: "", setSlug: vi.fn(), extFields: {}, setExtFields: vi.fn(), message: null, error: null, loadError: null, loaded: true, saving: false, busy: invalid, editor, save: vi.fn(), toggleLifecycle: vi.fn(), setFieldValidity: (_name, valid) => setInvalid(!valid), t: ({ key }) => key };
    },
    useJsonFieldControlHook: ({ value, fieldName, setFieldValidity }) => ({ text: JSON.stringify(value), parseError: false, handleTextChange: ({ nextText }) => setFieldValidity(fieldName, nextText !== "{") }),
  };
  const view = render(<CollectionEntryEditor {...props} />);
  expect(view.getByText("body slot")).toBeTruthy();
  expect(BodyEditor.mock.calls[0]?.[0].editor).toBe(editor);
  expect(EntryTerms).not.toHaveBeenCalled();
  expect(view.getByLabelText("metadata").textContent).toBe('{"saved":true}');
  fireEvent.change(view.getByLabelText("metadata"), { target: { value: "{" } });
  expect(view.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  view.rerender(<CollectionEntryEditor {...props} entryId="saved" />);
  expect(EntryTerms.mock.calls[0]?.[0]).toEqual({ contentType: "catalog", contentId: "saved" });
  expect(view.getByRole("link").getAttribute("href")).toBe("/entries/catalog");
});

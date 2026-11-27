// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CollectionEntryEditor, type CollectionEntryEditorProps } from "../CollectionEntryEditor.js";
import { EntryFieldsSection } from "../CollectionEntryEditor.fields.js";

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

it("edits schema fields with their native value types and invokes the action for the current publish state", () => {
  const save = vi.fn();
  const toggleLifecycle = vi.fn();
  let savedFields: Record<string, unknown> = {};
  const storedFields: Record<string, unknown> = { quantity: 7, weight: 1.25, listed: false, supplier: "source-5", shipsAt: "2026-01-02T12:45" };
  const props: CollectionEntryEditorProps<string> = {
    contentTypeKey: "catalog", entryId: "entry-5", BodyEditor: ({ editor }) => <p>{editor}</p>, EntryTerms: () => <p>Terms</p>,
    ServerLabel: ({ value }) => <span>{value}</span>, entryListHref: ({ contentTypeKey }) => "/collections/" + contentTypeKey,
    readStoredField: ({ name }) => storedFields[name],
    useJsonFieldControlHook: () => { throw new Error("no JSON fields in this schema"); },
    useCollectionEntryEditorHook: ({ entryId }) => {
      const [extFields, setExtFields] = useState<Record<string, unknown>>({});
      return { contentType: { label: "Catalog", fields: [
        { name: "quantity", kind: "integer", required: true, queryable: false },
        { name: "weight", kind: "real", required: false, queryable: false },
        { name: "listed", kind: "boolean", required: false, queryable: false },
        { name: "supplier", kind: "relation", required: false, queryable: false },
        { name: "shipsAt", kind: "datetime", required: false, queryable: false },
      ] }, entry: { id: entryId ?? "entry-5", slug: "fixed-slug", status: entryId === "entry-5" ? "published" : "draft" },
        title: "Stationery", setTitle: vi.fn(), slug: "", setSlug: vi.fn(), extFields, setExtFields, message: null, error: null, loadError: null,
        loaded: true, saving: false, busy: false, editor: "Entry body", save: () => { savedFields = extFields; save(); },
        toggleLifecycle, setFieldValidity: vi.fn(), t: ({ key }) => key };
    },
  };
  const view = render(<CollectionEntryEditor {...props} />);
  const quantity = view.getByLabelText("quantity *");
  const weight = view.getByLabelText("weight");
  const listed = view.getByRole("checkbox", { name: "listed" });
  expect(quantity).toHaveValue(7);
  expect(quantity).toHaveAttribute("step", "1");
  expect(weight).toHaveValue(1.25);
  expect(listed).not.toBeChecked();
  expect(view.getByLabelText("shipsAt")).toHaveValue("2026-01-02T12:45");
  fireEvent.change(quantity, { target: { value: "" } });
  fireEvent.change(weight, { target: { value: "2.75" } });
  fireEvent.click(listed);
  fireEvent.change(view.getByLabelText("supplier"), { target: { value: "source-9" } });
  fireEvent.change(view.getByLabelText("shipsAt"), { target: { value: "2026-01-03T09:15" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledExactlyOnceWith();
  expect(savedFields).toStrictEqual({ quantity: undefined, weight: 2.75, listed: true, supplier: "source-9", shipsAt: "2026-01-03T09:15" });
  expect(view.queryByRole("button", { name: "Publish", exact: true })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Unpublish", exact: true }));
  view.rerender(<CollectionEntryEditor {...props} entryId="draft-6" />);
  expect(view.queryByRole("button", { name: "Unpublish", exact: true })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Publish", exact: true }));
  expect(toggleLifecycle.mock.calls).toEqual([[{ op: "unpublish" }], [{ op: "publish" }]]);
});

it("keeps a cleared optional numeric input blank even when an older value is stored", () => {
  function Fields() {
    const [extFields, setExtFields] = useState<Record<string, unknown>>({});
    return <EntryFieldsSection fields={[{ name: "quantity", kind: "integer", required: false, queryable: false }]}
      readStoredField={() => 7} entry={{ fieldsJson: { quantity: 7 } }} extFields={extFields}
      useJsonFieldControlHook={() => { throw new Error("no JSON fields in this schema"); }}
      onFieldChange={(name, value) => setExtFields(fields => ({ ...fields, [name]: value }))}
      setFieldValidity={() => {}} t={({ key }) => key}
    />;
  }
  const view = render(<Fields />);
  const quantity = view.getByRole("spinbutton", { name: "quantity" });
  expect(quantity).toHaveValue(7);
  fireEvent.change(quantity, { target: { value: "" } });
  expect(quantity).toHaveValue(null);
});

// @vitest-environment jsdom
import { fireEvent, render, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { WidgetConfigFields, type WidgetConfigFieldsProps } from "../WidgetConfigFields.js";

afterEach(cleanup);

it("forwards collection changes to the reset-owning hook with either test catalog", async () => {
  const setCollection = vi.fn();
  const props: WidgetConfigFieldsProps = {
    widgetType: "recent-entries", config: { collection: "first", sort: "-price" }, onChange: vi.fn(), t: key => key, MediaContentEditor: () => null,
    port: { listCollections: async () => [], listMenus: async () => [], listForms: async () => [] },
    useFetchedOptionsHook: () => ({ items: null, error: null }),
    useRecentEntriesConfigHook: () => ({ collection: "first", sort: "-price", layout: "", columns: "", fields: [], filterField: "", filterValue: "", setCollection, setSort: vi.fn(), setLayout: vi.fn(), setColumns: vi.fn(), toggleField: vi.fn(), setFilterField: vi.fn(), setFilterValue: vi.fn() }),
    useSocialLinksConfigHook: () => ({ links: [], updateLink: vi.fn(), removeLink: vi.fn(), addLink: vi.fn() }),
    rules: { COLLECTION_DISPLAYABLE_FIELD_KINDS: new Set(["text", "integer"]), humanizeFieldName: ({ name }) => name, asciiSlug: ({ text }) => text },
  };
  const first = [{ key: "first", label: "First", fields: [{ name: "price", kind: "integer" as const }] }, { key: "second", label: "Second", fields: [{ name: "title", kind: "text" as const }] }];
  const second = [{ key: "other", label: "Other", fields: [] }];
  const useFetchedOptionsHook: WidgetConfigFieldsProps["useFetchedOptionsHook"] = <T,>({ fetchList }: { fetchList: () => Promise<T[]> }) => {
    const [items, setItems] = useState<T[] | null>(null);
    useEffect(() => { void fetchList().then(setItems); }, []);
    return { items, error: null };
  };
  for (const catalog of [first, second]) {
    const view = render(<WidgetConfigFields {...props} port={{ ...props.port, listCollections: async () => catalog }} useFetchedOptionsHook={useFetchedOptionsHook} />);
    await waitFor(() => expect(view.getByLabelText("Collection").hasAttribute("disabled")).toBe(false));
    fireEvent.change(view.getByLabelText("Collection"), { target: { value: catalog.length > 1 ? "second" : "other" } });
    view.unmount();
  }
  expect(setCollection.mock.calls).toEqual([[{ value: "second" }], [{ value: "other" }]]);
});

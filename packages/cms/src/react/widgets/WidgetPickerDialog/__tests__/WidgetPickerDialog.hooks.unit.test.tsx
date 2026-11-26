// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useWidgetPickerDialog } from "../WidgetPickerDialog.hooks.js";
import type { ReactNode } from "react";

it("cancels an existing selection without creation and reopens with the baseline draft", async () => {
  const onCreateNew = vi.fn();
  const onCancel = vi.fn();
  const required: Parameters<typeof useWidgetPickerDialog>[0] = {
    props: { widgetType: "text", onUseExisting: vi.fn(), onCreateNew, onCancel },
    deps: { port: { listWidgets: async () => ({ widgets: [{ id: "existing", workspaceId: "workspace", slug: "existing", title: "Existing", status: "active", widgetType: "text", config: {}, updatedAt: "2026-11-25", version: 1 }]), createWidget: vi.fn() },
      useAdminLocaleHook: () => "en", useFetchQuery, defaultWidgetConfig: () => ({}), WIDGET_TYPE_OPTIONS: [{ value: "text", label: "Text" }],
      widgetTypeLabel: ({ widgetType }) => widgetType, translateWidgets: ({ key }) => key, sharedComponentsT: ({ key }) => key,
      describeApiError: ({ fallback }) => fallback },
  };
  const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
  const first = renderHook(() => useWidgetPickerDialog(required), { wrapper });
  await waitFor(() => expect(first.result.current.instances?.length).toBe(1));
  act(() => { first.result.current.setSelectedExistingId("existing"); first.result.current.setNewTitle("Unsubmitted draft"); });
  act(() => required.props.onCancel());
  first.unmount();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCreateNew).not.toHaveBeenCalled();
  expect(required.deps.port.createWidget).not.toHaveBeenCalled();
  const reopened = renderHook(() => useWidgetPickerDialog(required), { wrapper });
  expect(reopened.result.current.selectedExistingId).toBe("");
  expect(reopened.result.current.newTitle).toBe("");
  expect(reopened.result.current.newConfig).toEqual({});
  reopened.unmount();
});

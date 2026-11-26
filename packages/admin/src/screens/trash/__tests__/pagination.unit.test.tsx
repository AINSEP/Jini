// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "../../../__tests__/fetch-query-support.js";
import { expect, it } from "vitest";
import type { AdminTrashItemDto } from "@jini-ai/core/contracts/site/cms-trash";
import { Trash } from "../Trash.js";
import type { TrashController } from "../hooks/use-trash.hooks.js";

it("an empty filtered page can load the next visible trash item", () => {
  const allowed: AdminTrashItemDto = {
    id: "trash-allowed", entityType: "post", entityId: "allowed", title: "Allowed post",
    subtitle: null, trashedAt: "2026-11-25T00:00:00.000Z", purgeAfter: "2026-12-25T00:00:00.000Z",
    daysRemaining: 30, actorPrincipalId: "user-1", actorPluginId: null,
  };
  function useTrashHook(): TrashController {
    const [items, setItems] = useState<AdminTrashItemDto[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>("next-page");
    return {
      items, nextCursor, retentionDays: 30, loadingMore: false,
      loadMore: () => { setItems([allowed]); setNextCursor(null); },
      error: null, notice: null, busy: false, selected: new Set<string>(),
      toggle: () => {}, toggleAll: () => {}, allSelected: false,
      onRestoreSelected: async () => {}, purgeConfirmOpen: false, setPurgeConfirmOpen: () => {},
      onPurgeConfirmed: async () => {}, refresh: () => {}, refreshing: false,
      actorUsernames: new Map<string, string>(), locale: "en", t: ({ key }) => key,
    };
  }

  render(<Trash useTrashHook={useTrashHook} translateAdminNavLabel={({ key }) => key} />);
  expect(screen.queryByText("The Trash is empty.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.getByText("Allowed post")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

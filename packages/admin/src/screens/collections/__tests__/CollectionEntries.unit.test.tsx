// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectionEntries as CollectionEntriesScreen, type CollectionEntriesProps } from "../CollectionEntries.js";
import type { CollectionEntriesController } from "../hooks/use-collection-entries.hooks.js";

/**
 * @file `CollectionEntries` — pins the fix for the audit's live-verified blocker (exec summary
 * #1): a bogus `contentTypeKey` (e.g. a stale bookmark) previously rendered as a real, empty,
 * *creatable* collection — a working "New entry" button and no error anywhere — because nothing
 * checked the `contentType === null` case the lookup already distinguished from "still loading".
 * Every case here drives the screen through a fake controller (`useCollectionEntriesHook` is a
 * required prop); the host's real-hook path is covered by Tovu's host-wiring test.
 */

/** Stand-in for the host's `ServerLabel`: the status word, capitalised. */
function StatusLabel({ value }: { value: string }) {
  return <>{value.charAt(0).toUpperCase() + value.slice(1)}</>;
}

function CollectionEntries(props: Pick<CollectionEntriesProps, "contentTypeKey" | "useCollectionEntriesHook">) {
  return <CollectionEntriesScreen {...props} StatusLabel={StatusLabel} publishButton={<button type="button">Publish collections</button>} />;
}

describe("loaded entries and errors", () => {
  const entry = {
    id: "e1", workspaceId: "w1", type: "recipe", slug: "my-recipe", status: "draft" as const,
    title: "My Recipe", bodyJson: null, fieldsJson: null, publishedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1,
  };
  const contentType = { workspaceId: "w1", key: "recipe", label: "Recipe", status: "active" as const, version: 1, fields: [] };

  it.each([null, [], [entry]])("shows load errors with entries %j", (entries) => {
    const controller: CollectionEntriesController = { contentType, entries, error: "entries unavailable", t: ({ key }, _optional = {}) => key };
    render(<CollectionEntries contentTypeKey="recipe" useCollectionEntriesHook={() => controller} />);
    expect(screen.getByText("entries unavailable")).toHaveClass("jini-notice", "jini-notice-error");
    if (entries?.length) expect(screen.getByRole("link", { name: "My Recipe" })).toBeInTheDocument();
    if (entries === null) expect(screen.queryByRole("link", { name: /new entry/i })).not.toBeInTheDocument();
  });
});

describe("injected hook seam (useCollectionEntriesHook)", () => {
  it("renders from a fake controller, proving the real hook is not hardcoded — no fetch involved", () => {
    const controller: CollectionEntriesController = {
      contentType: null,
      entries: [],
      error: null,
      t: ({ key }, _optional = {}) => key,
    };
    render(<CollectionEntries contentTypeKey="does-not-matter" useCollectionEntriesHook={() => controller} />);

    // The real hook can never resolve `contentType: null` synchronously on first render (it starts
    // `undefined` until the fetch settles) — reaching this branch with no `act`/`waitFor` is only
    // possible because the fake bypassed `useWiredCollectionEntries` entirely.
    expect(screen.getByText('Unknown content type "does-not-matter".')).toBeInTheDocument();
  });

  // readable-slugs S6b (2026-09-23): the list row links by slug, not the raw id — same rule
  // Posts/Pages/Widgets/Menus rows already follow.
  it("wraps the entry status cell in the host stylesheet's jini-status classes", () => {
    const controller: CollectionEntriesController = {
      contentType: { workspaceId: "w1", key: "recipe", label: "Recipe", status: "active", version: 1, fields: [] },
      entries: [{
        id: "e1", workspaceId: "w1", type: "recipe", slug: "my-recipe", status: "draft", title: "My Recipe", bodyJson: null,
        fieldsJson: null, publishedAt: null, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1,
      }],
      error: null,
      t: ({ key }, _optional = {}) => key,
    };
    render(<CollectionEntries contentTypeKey="recipe" useCollectionEntriesHook={() => controller} />);
    expect(screen.getByText("Draft").closest("span")?.className).toBe("jini-status jini-status-draft");
  });

  it("links an entry row by its slug, not its id", () => {
    const controller: CollectionEntriesController = {
      contentType: { workspaceId: "w1", key: "recipe", label: "Recipe", status: "active", version: 1, fields: [] },
      entries: [
        {
          id: "e1",
          workspaceId: "w1",
          type: "recipe",
          slug: "my-recipe",
          status: "draft",
          title: "My Recipe",
          bodyJson: null,
          fieldsJson: null,
          publishedAt: null,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          version: 1,
        },
      ],
      error: null,
      t: ({ key }, _optional = {}) => key,
    };
    render(<CollectionEntries contentTypeKey="recipe" useCollectionEntriesHook={() => controller} />);

    const link = screen.getByRole("link", { name: "My Recipe" });
    expect(link).toHaveAttribute("href", "/admin/collections/recipe/my-recipe");
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish collections" })).toBeInTheDocument();
  });
});

it("shows the loading notice when the registry lookup is unresolved, even with an empty entry list", () => {
  render(<CollectionEntries contentTypeKey="recipe" useCollectionEntriesHook={() => ({
    contentType: undefined, entries: [], error: null, t: ({ key }) => key,
  })} />);
  expect(screen.getByText("Loading entries…")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "New entry" })).not.toBeInTheDocument();
});

it("does not expose the create action while entry data is still pending for a known collection", () => {
  const contentType = { workspaceId: "w1", key: "recipe", label: "Recipe", status: "active" as const, version: 2, fields: [] };
  render(<CollectionEntries contentTypeKey="recipe" useCollectionEntriesHook={() => ({
    contentType, entries: null, error: null, t: ({ key }) => key,
  })} />);
  expect(screen.getByText("Loading entries…")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "New entry" })).not.toBeInTheDocument();
});

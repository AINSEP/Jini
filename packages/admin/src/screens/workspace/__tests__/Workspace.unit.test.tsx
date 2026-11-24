// @vitest-environment jsdom
import { render as renderOriginal, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Workspace as WorkspaceScreen, type WorkspaceController, type WorkspaceProps } from "../Workspace.js";

import type { AdminWorkspaceResponse } from "@jini-ai/core/contracts/site/cms-workspace";

import { formatTimestamp } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../../../shell/lib/viewer-time-zone.js";
/**
 * @file `Workspace` — the workspace settings screen, driven through the REQUIRED `useWorkspaceHook`
 * dependency-injection seam. The host's workspace feature was 0% covered with no test file at all
 * before this pass.
 */

const render = renderOriginal;
/** The host's delete copy arrives as a prop; these are the strings the host passes. */
const DELETION = {
  lead: "Every install must always have at least one workspace, so deleting your only workspace is not available.",
  unavailableTitle: "Not available — this install has only one workspace",
};
function Workspace(props: Omit<WorkspaceProps, "deletion">) {
  return <WorkspaceScreen {...props} deletion={DELETION} />;
}

const WORKSPACE: AdminWorkspaceResponse = {
  id: "w1",
  name: "My Site",
  slug: "my-site",
  createdAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

function baseController(overrides: Partial<WorkspaceController> = {}): WorkspaceController {
  return {
    workspace: WORKSPACE,
    error: null,
    name: WORKSPACE.name,
    setName: vi.fn(),
    slug: WORKSPACE.slug,
    setSlug: vi.fn(),
    saving: false,
    saveError: null,
    saved: false,
    onSave: vi.fn(async (e) => e.preventDefault()),
    t: (key: string) => key,
    locale: "en",
    ...overrides,
  };
}

describe("loading and error states", () => {
  it("shows a loading placeholder before the workspace has loaded", () => {
    render(<Workspace useWorkspaceHook={() => baseController({ workspace: null })} />);
    expect(screen.getByText("Loading workspace…")).toBeInTheDocument();
  });

  it("shows the error message instead of the form when the load failed", () => {
    render(<Workspace useWorkspaceHook={() => baseController({ error: "failed to load workspace" })} />);
    expect(screen.getByText("failed to load workspace")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});

describe("rename form", () => {
  it("renders the persisted name/slug/id/createdAt", () => {
    render(<Workspace useWorkspaceHook={() => baseController()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("My Site");
    expect(screen.getByLabelText("Slug")).toHaveValue("my-site");
    expect(screen.getByText("w1")).toBeInTheDocument();
    // Formatted display (`formatTimestamp`), not the raw ISO-8601 value — see `Workspace.tsx`'s
    // own comment on the created-at cell for why.
    expect(screen.getByText(formatTimestamp({ iso: WORKSPACE.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE }))).toBeInTheDocument();
  });

  it("Save is disabled while the draft matches the persisted workspace (not dirty)", () => {
    render(<Workspace useWorkspaceHook={() => baseController()} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("Save becomes enabled once the draft name diverges, and typing routes through setName", async () => {
    const user = userEvent.setup();
    const setName = vi.fn();
    const setSlug = vi.fn();
    function useStatefulWorkspace(): WorkspaceController {
      const [name, updateName] = useState(WORKSPACE.name);
      const [slug, updateSlug] = useState(WORKSPACE.slug);
      return baseController({ name, slug,
        setName: (value) => { setName(value); updateName(value); },
        setSlug: (value) => { setSlug(value); updateSlug(value); },
      });
    }
    render(<Workspace useWorkspaceHook={useStatefulWorkspace} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "New Name!");
    expect(setName).toHaveBeenLastCalledWith("New Name!");
    expect(screen.getByLabelText("Name")).toHaveValue("New Name!");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await user.clear(screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "new-slug");
    expect(setSlug).toHaveBeenLastCalledWith("new-slug");
    expect(screen.getByLabelText("Slug")).toHaveValue("new-slug");
    expect(setName).toHaveBeenLastCalledWith("New Name!");
  });

  it("submitting the form calls onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (e: React.FormEvent) => e.preventDefault());
    render(<Workspace useWorkspaceHook={() => baseController({ name: "New Name", onSave })} />);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalled();
  });

  it("shows Saving… and disables Save while a save is in flight", () => {
    render(<Workspace useWorkspaceHook={() => baseController({ name: "New Name", saving: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("shows the save error banner", () => {
    render(<Workspace useWorkspaceHook={() => baseController({ saveError: "slug already in use" })} />);
    expect(screen.getByText("slug already in use")).toBeInTheDocument();
  });

  it("shows Saved. only once saved is true AND the form is no longer dirty", () => {
    const { rerender } = render(<Workspace useWorkspaceHook={() => baseController({ saved: true })} />);
    expect(screen.getByText("Saved.")).toBeInTheDocument();

    rerender(<Workspace useWorkspaceHook={() => baseController({ saved: true, name: "Changed Since Save" })} />);
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});

describe("showPageHeader", () => {
  // The host settings screen mounts this component inside `SettingsDialogShell`'s own chrome, which
  // already renders this tab's title/subtitle — `showPageHeader={false}` is how that caller avoids
  // a doubled "Workspace" heading. See `WorkspaceProps.showPageHeader`'s own doc for the full
  // reasoning and why it suppresses the whole block, not just the `<h1>`.
  it("renders the page-header (kicker, title, description) by default, unchanged from before this prop existed", () => {
    render(<Workspace useWorkspaceHook={() => baseController()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("This site's identity — its name, URL slug, and creation date.")).toBeInTheDocument();
  });

  it("renders none of the page-header when showPageHeader is false, but the form/identity/delete sections are untouched", () => {
    render(<Workspace useWorkspaceHook={() => baseController()} showPageHeader={false} />);
    expect(screen.queryByRole("heading", { level: 1, name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByText("This site's identity — its name, URL slug, and creation date.")).not.toBeInTheDocument();

    // Everything below the header is unaffected — this prop only touches the header block.
    expect(screen.getByLabelText("Name")).toHaveValue("My Site");
    expect(screen.getByRole("heading", { level: 2, name: "Delete workspace" })).toBeInTheDocument();
  });
});

describe("Delete workspace", () => {
  it("is always visible, permanently disabled, with an explanatory notice", () => {
    render(<Workspace useWorkspaceHook={() => baseController()} />);
    const deleteButton = screen.getByRole("button", { name: "Delete workspace" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute("title", "Not available — this install has only one workspace");
    expect(screen.getByText(/every install must always have at least one workspace/i)).toBeInTheDocument();
  });
});

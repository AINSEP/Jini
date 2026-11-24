import { render, screen } from '../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from "vitest";

import { Members } from "../Members.js";
import { emptyRowState } from "../rules.js";
import type { MembersController } from "../hooks/use-members.hooks.js";
import { createFakeMembersPort } from "../../testing.js";
import type { AdminMember } from "../../models.js";

const translate = (key: string) => key;
const FROM_HOOK: AdminMember = { id: "m-hook", workspaceId: "w1", email: "from-hook@example.com", name: "Hooked", status: "active",
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };

function stubController(overrides: Partial<MembersController> = {}): MembersController {
  return {
    members: [FROM_HOOK], error: null, stateFor: () => emptyRowState({}), onResendSignInLink: async () => {},
    expandedId: null, detailById: {}, detailError: null, detailLoadingId: null, onToggleDetail: async () => {},
    confirmingDisable: null, setConfirmingDisable: () => {}, confirmDisable: async () => {},
    t: key => `bound:${key}`, translate: key => `bound:${key}`, ...overrides,
  };
}

/** `Members` has no default hook and imports none: every controller it renders comes from the `useMembersHook` its host binds. */
describe("Members gets its controller only from the useMembersHook prop", () => {
  it("renders what the supplied hook returns and calls it with the screen's own inputs", () => {
    const port = createFakeMembersPort({}, { members: [] });
    const refresh = { subscribe: () => () => {} };
    const useMembersHook = vi.fn(() => stubController());
    render(<Members useMembersHook={useMembersHook} port={port} translate={translate} queryScope="tenant-a" refresh={refresh} />);
    expect(screen.getByText("from-hook@example.com")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "bound:Members" })).toBeTruthy();
    expect(useMembersHook).toHaveBeenCalledWith({ port, translate, queryScope: "tenant-a" }, { refresh });
  });

  it("shows the loading and error notices the supplied hook reports", () => {
    const port = createFakeMembersPort({}, { members: [] });
    const { rerender } = render(<Members useMembersHook={() => stubController({ members: null })} port={port} translate={translate} />);
    expect(screen.getByText("bound:Loading members…")).toBeTruthy();
    rerender(<Members useMembersHook={() => stubController({ error: "hook says no" })} port={port} translate={translate} />);
    expect(screen.getByText("hook says no")).toBeTruthy();
  });

  it("has no hidden default: omitting the hook fails instead of falling back to a built-in controller", () => {
    const port = createFakeMembersPort({}, { members: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // @ts-expect-error `useMembersHook` is a required prop — the type rejects the omission the runtime also refuses.
    expect(() => render(<Members port={port} translate={translate} />)).toThrow(TypeError);
    vi.restoreAllMocks();
  });
});

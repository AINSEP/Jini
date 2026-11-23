import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import { act, render, renderHook, screen, waitFor } from "../../__tests__/fetch-query-support.js";
import { realUmKit } from "../../__tests__/fetch-query-support.js";
import { UserManagementKitProvider } from "../../kit.js";
import { createFakeUsersPort } from "../../testing.js";
import { UsersPanel } from "../UsersPanel.js";
import { useLocalizedUsers } from "../hooks/use-localized-users.hooks.js";
import { createDictionaryTranslator } from "@jini-ai/core/text";

const t = createDictionaryTranslator({ featureDictionary: { es: { Users: "Usuarios" } } });
const ALICE = { principalId: "u1", workspaceId: "w1", username: "alice", status: "active" as const, createdAt: "2026-08-01T00:00:00.000Z", roleIds: [] as string[], policyIds: [] as string[] };
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected transport call"); })); });
afterEach(() => { vi.unstubAllGlobals(); });
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider><UserManagementKitProvider kit={realUmKit}>{children}</UserManagementKitProvider></FetchQueryProvider>; }

describe("useLocalizedUsers (moved host controller binding)", () => {
  it("binds the injected locale hook and translator onto the controller", async () => {
    const port = createFakeUsersPort({}, { users: [ALICE] });
    const { result } = renderHook(() => useLocalizedUsers({ port, useAdminLocale: () => "es", queryScope: "w1", t }), { wrapper });
    await waitFor(() => expect(result.current.users).toEqual([ALICE]));
    expect(result.current.locale).toBe("es");
    expect(result.current.t("Users")).toBe("Usuarios");
  });

  it("navigates to /users when the deep-linked own reset dialog closes", async () => {
    const navigate = vi.fn();
    const port = createFakeUsersPort({}, { users: [ALICE], meId: "u1" });
    const { result } = renderHook(() => useLocalizedUsers({ port, useAdminLocale: () => "en", queryScope: "w1", t, openOwnPasswordReset: true, navigate }), { wrapper });
    await waitFor(() => expect(result.current.resetPasswordFor?.principalId).toBe("u1"));
    act(() => { result.current.setResetPasswordFor(null); });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/users"));
  });
});

describe("UsersPanel", () => {
  it("renders the screen from the host's wired hook and forwards openOwnPasswordReset to it", async () => {
    const port = createFakeUsersPort({}, { users: [ALICE] });
    const seen: unknown[] = [];
    function useWired(options: { openOwnPasswordReset?: boolean | undefined } = {}) {
      seen.push(options.openOwnPasswordReset);
      return useLocalizedUsers({ port, useAdminLocale: () => "es", queryScope: "w1", t });
    }
    render(<UsersPanel useUsersHook={useWired} openOwnPasswordReset={false} port={port} queryScope="w1"
      renderServerLabel={({ value }) => <span data-testid="label">{value}</span>} />, { wrapper });
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getAllByText("Usuarios").length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });
});

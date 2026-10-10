import { act, render, renderHook, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/panel-kit";
import { createFakeUsersPort } from "../../testing.js";
import { useChangeUsername } from "../hooks/use-change-username.hooks.js";
import { useUsers } from "../hooks/use-users.hooks.js";
import { Users } from "../Users.js";
import type { AdminIdentityUser } from "../../models.js";

const alice: AdminIdentityUser = { principalId: "alice", workspaceId: "w", username: "alice", email: "kept@example.test",
  status: "active", roleIds: [], policyIds: [], createdAt: "2026-10-09", isOwner: false };
const owner: AdminIdentityUser = { ...alice, principalId: "owner", username: "owner", isOwner: true };
const t = (key: string) => key;
function wrapper({ children }: { children: React.ReactNode }) { return <FetchQueryProvider>{children}</FetchQueryProvider>; }
function portFor(caller: AdminIdentityUser, permissions: string[]) {
  const fake = createFakeUsersPort({}, { users: [owner, alice], meId: caller.principalId });
  return { ...fake, me: async () => ({ user: { id: caller.principalId }, canManageUserTrash: false, effectivePermissions: permissions }) };
}

it("writes only username, refreshes the list and profile, and keeps server failures and draft visible", async () => {
  const port = portFor(alice, ["user.manage"]); const update = vi.spyOn(port, "updateUser");
  const { result } = renderHook(() => useUsers({ port, translate: t, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(result.current.ownProfile).toEqual(alice));
  act(() => result.current.changeUsername!.open({ user: alice }));
  act(() => result.current.changeUsername!.setUsername("alice.new"));
  await act(async () => result.current.changeUsername!.confirm({}));
  expect(update).toHaveBeenCalledWith({ principalId: "alice" }, { username: "alice.new" });
  await waitFor(() => expect(result.current.ownProfile?.username).toBe("alice.new"));
  expect(result.current.ownProfile?.email).toBe("kept@example.test");
  expect(result.current.changeUsername!.target).toBeNull();
  update.mockRejectedValueOnce(Object.assign(new Error("only an owner can modify an owner principal"), { code: "OWNER_REQUIRED" }));
  act(() => result.current.changeUsername!.open({ user: result.current.ownProfile! }));
  act(() => result.current.changeUsername!.setUsername("next-name"));
  await act(async () => result.current.changeUsername!.confirm({}));
  expect(result.current.changeUsername!.error).toBe("The workspace must keep at least one active owner.");
  expect(result.current.changeUsername!.username).toBe("next-name");
  expect(result.current.changeUsername!.target?.principalId).toBe("alice");
  act(() => result.current.changeUsername!.cancel({}));
  expect(result.current.changeUsername!.target).toBeNull(); expect(result.current.changeUsername!.error).toBeNull();
});

it("refuses blank drafts, duplicate submits, cancellation and retargeting while a write is pending", async () => {
  const port = portFor(owner, ["*"]);
  let resolve!: (result: { user: AdminIdentityUser }) => void;
  const update = vi.spyOn(port, "updateUser").mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result } = renderHook(() => useChangeUsername({ port, translate: t, queryScope: "w", canRename: () => true }), { wrapper });
  act(() => result.current.open({ user: alice })); act(() => result.current.setUsername("   "));
  await act(async () => result.current.confirm({}));
  expect(update).not.toHaveBeenCalled(); expect(result.current.error).toBe("username must not be blank");
  act(() => result.current.setUsername("new-name"));
  let write!: Promise<void>;
  act(() => { write = result.current.confirm({}); });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await act(async () => result.current.confirm({}));
  act(() => { result.current.cancel({}); result.current.open({ user: owner }); });
  expect(result.current.target?.principalId).toBe("alice"); expect(update).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ user: { ...alice, username: "new-name" } }); await write; });
  expect(result.current.target).toBeNull();
});

it("hides owner renames from delegated managers and self renames from member.manage callers", async () => {
  const port = portFor(alice, ["user.manage"]);
  const { result, unmount } = renderHook(() => useUsers({ port, translate: t, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(result.current.ownProfile).toEqual(alice));
  expect(result.current.canRenameUser!(owner)).toBe(false); expect(result.current.canRenameUser!(alice)).toBe(true);
  act(() => result.current.changeUsername!.open({ user: owner })); expect(result.current.changeUsername!.target).toBeNull();
  unmount();
  const member = renderHook(() => useUsers({ port: portFor(alice, ["member.manage"]), translate: t, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(member.result.current.ownProfile).toEqual(alice));
  expect(member.result.current.canRenameUser!(alice)).toBe(false);
});

it("the Users row menu and own profile open the same shared rename dialog", async () => {
  const port = portFor(owner, ["*"]);
  render(<Users port={port} translate={t} queryScope="w" />, { wrapper });
  const profile = await screen.findByRole("region", { name: "My profile" });
  fireEvent.click(within(profile).getByRole("button", { name: "Change username" }));
  expect(screen.getByLabelText("New username")).toHaveValue("owner");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: 'Actions for user "alice"' }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Change username" }));
  fireEvent.change(screen.getByLabelText("New username"), { target: { value: "alice.new" } });
  // The profile button and dialog confirm share copy, so choose the rendered modal's button.
  const field = screen.getByLabelText("New username");
  const dialog = field.closest('dialog')!;
  fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Change username" }));
  await waitFor(() => expect(port.users.find(user => user.principalId === "alice")?.username).toBe("alice.new"));
});

it("translates reserved Trash usernames through the Users error describer and retains the draft", async () => {
  const port = portFor(alice, ["user.manage"]);
  const error = Object.assign(new Error("raw upstream reason"), { code: "USERNAME_IN_TRASH" });
  vi.spyOn(port, "updateUser").mockRejectedValue(error);
  const translate = (key: string) => key === "A user with this username is in the Trash; restore or delete them permanently first."
    ? "Dieser Benutzername ist im Papierkorb." : key;
  const { result } = renderHook(() => useChangeUsername({ port, translate, queryScope: "w", canRename: () => true }), { wrapper });
  act(() => { result.current.open({ user: alice }); });
  act(() => { result.current.setUsername("reserved"); });
  await act(async () => { await result.current.confirm({}); });
  expect(result.current.error).toBe("Dieser Benutzername ist im Papierkorb.");
  expect(result.current.username).toBe("reserved");
  expect(result.current.target).toEqual(alice);
});

it("keeps a host-protected bootstrap owner out of profile and row rename actions", async () => {
  const seededOwner = { ...owner, canRename: false };
  const fake = createFakeUsersPort({}, { users: [seededOwner, alice], meId: owner.principalId });
  const port = { ...fake, me: async () => ({ user: { id: owner.principalId }, canManageUserTrash: true, effectivePermissions: ["*"] }) };
  const hook = renderHook(() => useUsers({ port, translate: t, queryScope: "w" }), { wrapper });
  await waitFor(() => expect(hook.result.current.ownProfile).toEqual(seededOwner));
  expect(hook.result.current.canRenameOwnProfile).toBe(false);
  expect(hook.result.current.renameUserHandler!({ user: seededOwner })).toBeUndefined();
  act(() => hook.result.current.openOwnRename!());
  expect(hook.result.current.changeUsername!.target).toBeNull();
  act(() => hook.result.current.renameUserHandler!({ user: alice })!(alice));
  expect(hook.result.current.changeUsername!.target).toEqual(alice);
  hook.unmount();
  render(<Users port={port} translate={t} queryScope="w" />, { wrapper });
  const profile = await screen.findByRole("region", { name: "My profile" });
  expect(within(profile).queryByRole("button", { name: "Change username" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: 'Actions for user "owner"' }));
  expect(screen.queryByRole("menuitem", { name: "Change username" })).toBeNull();
});

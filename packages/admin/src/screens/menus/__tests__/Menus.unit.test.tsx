// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AdminMenu } from "../api/menus-api.types.js";
import type { MenusPort } from "../hooks/menus-port.hooks.js";
import { createFakeMenusPort } from "../hooks/menus-dependencies.hooks.js";
import { useMenus } from "../hooks/use-menus.hooks.js";
import { Menus } from "../Menus.js";
import { MENU, stubKit } from "./menus-fixtures.js";

const footer: AdminMenu = { ...MENU, id: "footer-id", slug: "site-footer", title: "Site footer" };
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
const kit = stubKit({ isApiError: (e): e is ApiError => e instanceof ApiError });
const t = (key: string) => key;
const useList = (port: MenusPort) => useMenus({ port, kit, t });

function portFor(menus: AdminMenu[] = [MENU, footer]) {
  const store = createFakeMenusPort({ menus });
  const listMenus = vi.fn(async () => ({ menus: (await store.listMenus()).menus.filter(({ status }) => status !== "trash") }));
  const trash = vi.fn(store.trash);
  return { ...store, listMenus, trash };
}

function mount(port: MenusPort) {
  const menuHref = vi.fn(({ slug }: { slug: string }) => `/cms/menu/${slug}`);
  return render(<Menus useMenusHook={() => useList(port)} publishAction={<button>Publish navigation</button>}
    newMenuHref="/cms/new-menu" menuHref={menuHref} />);
}

it("shows a loading state, then honest empty-list guidance and the host actions", async () => {
  let finish!: (rows: { menus: AdminMenu[] }) => void;
  const rows = new Promise<{ menus: AdminMenu[] }>(resolve => { finish = resolve; });
  const port = { ...portFor([]), listMenus: () => rows };
  mount(port);
  expect(screen.getByText("Loading menus…")).toBeVisible();
  await act(async () => finish({ menus: [] }));
  expect(screen.getByText("No menus yet.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Menus" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Add New" })).toHaveAttribute("href", "/cms/new-menu");
  expect(screen.getByRole("button", { name: "Publish navigation" })).toBeVisible();
});

it("renders the original list error or the fallback when the request rejects without an Error", async () => {
  const mounted = mount({ ...portFor(), listMenus: async () => { throw new Error("Menu service offline"); } });
  expect(await screen.findByText("Menu service offline")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Menus" })).toBeNull();
  mounted.unmount();

  mount({ ...portFor(), listMenus: async () => { throw "no response"; } });
  expect(await screen.findByText("failed to load menus")).toBeVisible();
  expect(screen.queryByText("Loading menus…")).toBeNull();
});

it("links rows by slug and trashes only the confirmed row, by ID", async () => {
  const user = userEvent.setup();
  const port = portFor();
  mount(port);
  const link = await screen.findByRole("link", { name: "Site footer" });
  expect(link).toHaveAttribute("href", "/cms/menu/site-footer");
  const row = link.closest("tr")!;
  expect(within(row).getByRole("cell", { name: "site-footer" })).toBeVisible();
  const button = within(row).getByRole("button", { name: "Trash" });
  await user.click(button);
  const dialog = within(screen.getByRole("dialog", { name: "Move to trash?" }));
  expect(dialog.getByText('Move "Site footer" to trash?')).toBeVisible();
  expect(port.trash.mock.calls).toEqual([]);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Move to trash?" })).toBeNull();
  expect(port.trash.mock.calls).toEqual([]);
  await user.click(button);
  await user.click(dialog.getByRole("button", { name: "Move to trash" }));
  expect(port.trash.mock.calls).toEqual([[{ id: "footer-id" }]]);
  await waitFor(() => expect(screen.queryByRole("link", { name: "Site footer" })).toBeNull());
  expect(screen.getByRole("link", { name: "Main menu" })).toHaveAttribute("href", "/cms/menu/main");
  expect((await port.getMenu({ id: "footer-id" })).menu.status).toBe("trash");
});

it.each([
  { error: new ApiError("server conflict", 409, "TRASH_VERSION_CHANGED"), expected: "This item changed since you loaded it. Reload and try again." },
  { error: new ApiError("No permission", 403), expected: "No permission" },
  { error: new Error("Connection lost"), expected: "Connection lost" },
  { error: "offline", expected: "delete failed" },
])("keeps the list on failure and displays $expected", async ({ error, expected }) => {
  const user = userEvent.setup();
  const port = portFor([footer]);
  port.trash.mockRejectedValueOnce(error);
  mount(port);
  expect(await screen.findByRole("link", { name: "Site footer" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Trash" }));
  await user.click(within(screen.getByRole("dialog", { name: "Move to trash?" })).getByRole("button", { name: "Move to trash" }));
  expect(await screen.findByText(expected)).toBeVisible();
  expect(screen.getByRole("link", { name: "Site footer" })).toBeVisible();
  expect(port.trash.mock.calls).toEqual([[{ id: "footer-id" }]]);
  await user.click(screen.getByRole("button", { name: "Trash" }));
  expect(screen.queryByText(expected)).toBeNull();
});

it("quietly refreshes a 404 trash after another operator already removed that menu", async () => {
  const port = portFor();
  port.trash.mockImplementationOnce(async ({ id }) => {
    const index = port.menus.findIndex((menu) => menu.id === id);
    if (index < 0) throw new Error(`Unexpected menu: ${id}`);
    port.menus.splice(index, 1);
    throw new ApiError("Already gone", 404);
  });
  const { result } = renderHook(() => useList(port));
  await waitFor(() => expect(result.current.menus).toEqual([MENU, footer]));
  await act(() => result.current.confirmTrash());
  expect(port.trash.mock.calls).toEqual([]);
  act(() => result.current.requestTrash(footer));
  await act(() => result.current.confirmTrash());
  await waitFor(() => expect(result.current.menus).toEqual([MENU]));
  expect(result.current.error).toBeNull();
  expect(result.current.pendingTrash).toBeNull();
  expect(port.trash.mock.calls).toEqual([[{ id: "footer-id" }]]);
});

it("shows pending only for the confirmed menu and does not close a different row's prompt when the older write settles", async () => {
  let finish!: () => void;
  const port = portFor();
  const write = port.trash.getMockImplementation()!;
  port.trash.mockImplementationOnce(async (target) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    return write(target);
  });
  const { result } = renderHook(() => useList(port));
  await waitFor(() => expect(result.current.menus).toEqual([MENU, footer]));
  act(() => result.current.requestTrash(MENU));
  let pending!: Promise<void>;
  act(() => { pending = result.current.confirmTrash(); });
  expect(result.current.trashing).toBe(true);
  act(() => result.current.requestTrash(footer));
  expect(result.current.trashing).toBe(false);
  // The mutation calls the port on a later tick; wait for the held write before releasing it.
  await waitFor(() => expect(port.trash.mock.calls).toEqual([[{ id: "m1" }]]));
  await act(async () => { finish(); await pending; });
  expect(result.current.pendingTrash).toEqual(footer);
  expect(result.current.trashing).toBe(false);
  expect(port.trash.mock.calls).toEqual([[{ id: "m1" }]]);
});

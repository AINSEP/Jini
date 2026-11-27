// @vitest-environment jsdom
import { act, render, screen, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { EmailTemplatesTab } from "../EmailTemplatesTab.js";
import type { EmailApi, EmailTemplateDetail } from "../email-api.types.js";
import { useEmailTemplates } from "../hooks/use-email-templates.hooks.js";

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Api = Pick<EmailApi, "listTemplates" | "createTemplate" | "renameTemplate" | "trashTemplate">;
const welcome: EmailTemplateDetail = {
  id: "welcome-9", name: "Welcome", subject: "Join {{site}}", fields: [{ name: "site" }, { name: "name" }], version: 3,
  updatedAt: "2026-11-24T10:00:00Z", html: "<p>Hello {{name}}</p>", undeclaredFields: [],
};
const footer: EmailTemplateDetail = {
  ...welcome, id: "footer-2", name: "Footer", subject: "Thanks", fields: [], version: 7,
};

function setup(initial: EmailTemplateDetail[] = [welcome, footer]) {
  const rows = new Map(initial.map(row => [row.id, row]));
  const api = {
    listTemplates: vi.fn<Api["listTemplates"]>(async () => ({ templates: [...rows.values()] })),
    createTemplate: vi.fn<Api["createTemplate"]>(async ({ name }) => {
      const created = { ...footer, id: "new-73", name, version: 1 };
      rows.set(created.id, created);
      return created;
    }),
    renameTemplate: vi.fn<Api["renameTemplate"]>(async ({ id, name, expectedVersion }) => {
      const prior = rows.get(id);
      if (!prior || expectedVersion !== prior.version) throw new ApiError(409, "Template changed");
      const row = { ...prior, name, version: prior.version + 1 };
      rows.set(id, row);
      return row;
    }),
    trashTemplate: vi.fn<Api["trashTemplate"]>(async ({ id }) => {
      if (!rows.delete(id)) throw new ApiError(404, "Template not found");
      return { ok: true };
    }),
  };
  const open = vi.fn();
  function View() {
    const controller = useEmailTemplates({ api, ApiError, open }, { newName: "Fresh draft" });
    return <EmailTemplatesTab locale="en" controller={controller} />;
  }
  return { api, open, render: () => render(<View />) };
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, action: string) {
  await user.click(screen.getByRole("button", { name: `Actions for "${name}"` }));
  await user.click(screen.getByRole("menuitem", { name: action }));
}

it("shows row-owned subject, fields and editor links and renames only the selected row using its version", async () => {
  const h = setup();
  h.render();
  const user = userEvent.setup();
  const link = await screen.findByRole("link", { name: "Welcome" });
  expect(link).toHaveAttribute("href", "/admin/email/templates/welcome-9");
  const row = within(link.closest("tr")!);
  expect(row.getByText("Join {{site}}")).toBeInTheDocument();
  expect(row.getByText("{{site}} {{name}}")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: "Footer" }).closest("tr")!).getByText("—")).toBeInTheDocument();

  await choose(user, "Welcome", "Rename");
  const dialog = within(screen.getByRole("dialog", { name: "Rename template" }));
  const name = dialog.getByRole("textbox", { name: "Name" });
  expect(name).toHaveValue("Welcome");
  await user.clear(name);
  await user.type(name, " New welcome ");
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("link", { name: "New welcome" })).toHaveAttribute("href", "/admin/email/templates/welcome-9");
  expect(h.api.renameTemplate.mock.calls).toEqual([[{ id: "welcome-9", name: "New welcome", expectedVersion: 3 }]]);
  expect(screen.getByRole("link", { name: "Footer" })).toHaveAttribute("href", "/admin/email/templates/footer-2");
  expect(screen.queryByRole("dialog", { name: "Rename template" })).not.toBeInTheDocument();
});

it("can cancel Trash without a write and removes only the confirmed row while preserving its neighbor", async () => {
  const h = setup();
  const user = userEvent.setup();
  const remove = h.api.trashTemplate.getMockImplementation()!;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  h.api.trashTemplate.mockImplementationOnce(async input => { await gate; return remove(input); });
  h.render();
  await screen.findByRole("link", { name: "Footer" });
  await choose(user, "Footer", "Move to trash");
  let dialog = within(screen.getByRole("dialog", { name: "Move to trash?" }));
  expect(dialog.getByText('"Footer" moves to Trash. You can restore it from there.')).toBeInTheDocument();
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(h.api.trashTemplate).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Footer" })).toBeInTheDocument();

  await choose(user, "Footer", "Move to trash");
  dialog = within(screen.getByRole("dialog", { name: "Move to trash?" }));
  await user.click(dialog.getByRole("button", { name: "Move to trash" }));
  expect(dialog.getByRole("button", { name: "Move to trash" })).toBeDisabled();
  expect(h.api.trashTemplate.mock.calls).toEqual([[{ id: "footer-2" }]]);
  await act(async () => { finish(); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Footer" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Welcome" })).toBeInTheDocument();
  expect((await h.api.listTemplates()).templates.map(row => row.id)).toEqual(["welcome-9"]);
});

it("shows an empty template list, announces a refused create, and opens the created draft on retry", async () => {
  const h = setup([]);
  const user = userEvent.setup();
  const create = h.api.createTemplate.getMockImplementation()!;
  let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  h.api.createTemplate.mockRejectedValueOnce(new ApiError(503, "Template storage unavailable"))
    .mockImplementationOnce(async input => { await gate; return create(input); });
  h.render();
  expect(await screen.findByText("No templates yet.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Template storage unavailable");
  expect(h.open).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "New template" }));
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await act(async () => { unblock(); });
  expect(h.open.mock.calls).toEqual([["/email/templates/new-73"]]);
  expect(h.api.createTemplate.mock.calls).toEqual([[{ name: "Fresh draft" }], [{ name: "Fresh draft" }]]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

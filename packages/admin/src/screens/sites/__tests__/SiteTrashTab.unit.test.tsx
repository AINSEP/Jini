// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteTrashTab } from "../SiteTrashTab.js";
import type { SitesLifecycleController, SitesScreenSnapshot, SiteTrashPolicy } from "../sites-screen-ports.js";

/**
 * @file Site Trash: the host's policy decides the subtitle and which buttons apply; the screen
 * renders one card per trashed site, routes Restore / Delete permanently through the injected
 * controller, and follows each new listing. Literal fixtures, no module mocks.
 */

const policy: SiteTrashPolicy = {
  resolveSiteSubtitle: (site) => (site.displayName === site.name ? null : site.displayName),
  resolveTrashCardActions: ({ id, checked, busyName }) => ({ selected: checked[id] === true, restoreDisabled: busyName !== null, deleteDisabled: checked[id] !== true || busyName !== null }),
};
const t = (key: string) => key;

function controller(calls: unknown[], overrides: Partial<SitesLifecycleController> = {}): SitesLifecycleController {
  return { busyName: null, checked: {}, toggleChecked(id, checked) { calls.push(["toggle", id, checked]); }, run(id, action) { calls.push([id, action]); }, ...overrides };
}

function snapshot(trash: NonNullable<SitesScreenSnapshot["trash"]>): SitesScreenSnapshot {
  return { localManagementEnabled: true, trash };
}

describe("SiteTrashTab", () => {
  it("renders nothing without local management or a controller, and the empty line for an empty Trash", () => {
    const { container, rerender } = render(<SiteTrashTab snapshot={{ trash: [] }} controller={controller([])} policy={policy} t={t} />);
    expect(container.innerHTML).toBe("");
    rerender(<SiteTrashTab snapshot={snapshot([])} policy={policy} t={t} />);
    expect(container.innerHTML).toBe("");
    rerender(<SiteTrashTab snapshot={snapshot([])} controller={controller([])} policy={policy} t={t} />);
    expect(screen.getByText("Site Trash is empty.")).toHaveClass("jini-sites-empty-lead");
  });

  it("restores any card, offers permanent deletion only once selected, and shows the policy subtitle", () => {
    const calls: unknown[] = [];
    const trash = [{ id: "id-a", name: "alpha", displayName: "Alpha Co" }, { id: "id-b", name: "beta", displayName: "beta" }];
    const { rerender } = render(<SiteTrashTab snapshot={snapshot(trash)} controller={controller(calls)} policy={policy} t={t} />);
    expect(screen.getByText("Alpha Co")).toHaveClass("jini-site-card-display-name");
    expect(screen.queryByText("beta", { selector: "p" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore beta" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select for permanent deletion alpha" }));
    rerender(<SiteTrashTab snapshot={snapshot(trash)} controller={controller(calls, { checked: { "id-a": true } })} policy={policy} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently alpha" }));
    expect(calls).toEqual([["id-b", "restore"], ["toggle", "id-a", true], ["id-a", "delete"]]);
    rerender(<SiteTrashTab snapshot={snapshot(trash)} controller={controller(calls, { checked: { "id-a": true }, busyName: "alpha" })} policy={policy} t={t} />);
    expect(screen.getByRole("button", { name: "Restore alpha" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete permanently alpha" })).toBeDisabled();
  });

  it("follows each refreshed listing: a restored site leaves, a newly trashed one appears", () => {
    // Mutation (trash refresh): keep the first render's `snapshot.trash` in state; beta never shows.
    const ctl = controller([]);
    const { rerender } = render(<SiteTrashTab snapshot={snapshot([{ id: "id-a", name: "alpha", displayName: "alpha" }])} controller={ctl} policy={policy} t={t} />);
    expect(screen.getByRole("button", { name: "Restore alpha" })).toBeInTheDocument();
    rerender(<SiteTrashTab snapshot={snapshot([{ id: "id-b", name: "beta", displayName: "beta" }])} controller={ctl} policy={policy} t={t} />);
    expect(screen.queryByRole("button", { name: "Restore alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore beta" })).toBeInTheDocument();
    rerender(<SiteTrashTab snapshot={snapshot([])} controller={ctl} policy={policy} t={t} />);
    expect(screen.getByText("Site Trash is empty.")).toBeInTheDocument();
  });
});

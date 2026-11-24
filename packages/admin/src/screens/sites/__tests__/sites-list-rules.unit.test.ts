import { describe, expect, it } from "vitest";
import {
  resolveSiteListItems, resolveSiteSubtitle, resolveSitesEmpty, resolveSitesRowHandles,
  resolveTrashCardActions, resolveTrashDeleteDisabled,
} from "../sites-list-rules.js";

/**
 * @file The Sites list's neutral rules, moved from the host with their tests. Literal fixtures only.
 */

const entry = (name: string) => ({ name, displayName: name, createdAt: "2026-01-01T00:00:00.000Z", dir: `/sites/${name}` });

describe("resolveSitesEmpty", () => {
  it("is true only for an empty list", () => {
    expect(resolveSitesEmpty({ sites: [] })).toBe(true);
    expect(resolveSitesEmpty({ sites: [entry("alpha")] })).toBe(false);
  });
});

describe("resolveSiteSubtitle", () => {
  it("is null when the display name only repeats the folder name — initSite's own default", () => {
    // `initSite` defaults `config.json.name` to the folder basename, so this is the common case and
    // rendering it would spend a line of the compact card saying the same word twice.
    expect(resolveSiteSubtitle(entry("alpha"))).toBeNull();
  });

  it("is the display name when an operator has actually set a different one", () => {
    expect(resolveSiteSubtitle({ ...entry("alpha"), displayName: "Alpha Client Site" })).toBe("Alpha Client Site");
  });
});

it("resolveTrashCardActions exposes delete only after selection and blocks both while busy", () => {
  expect(resolveTrashCardActions({ id: "x", checked: {}, busyName: null })).toEqual({ selected: false, restoreDisabled: false, deleteDisabled: true });
  expect(resolveTrashCardActions({ id: "x", checked: { x: true }, busyName: null })).toEqual({ selected: true, restoreDisabled: false, deleteDisabled: false });
  expect(resolveTrashCardActions({ id: "x", checked: { x: true }, busyName: "y" })).toEqual({ selected: true, restoreDisabled: true, deleteDisabled: true });
});

it("resolveTrashDeleteDisabled needs the row's own checkbox and an idle controller", () => {
  expect(resolveTrashDeleteDisabled({ id: "x", checked: { x: true }, busyName: "y" })).toBe(true);
  expect(resolveTrashDeleteDisabled({ id: "x", checked: { y: true }, busyName: null })).toBe(true);
  expect(resolveTrashDeleteDisabled({ id: "x", checked: { x: true }, busyName: null })).toBe(false);
});

describe("resolveSitesRowHandles", () => {
  it("derives one sites-row handle per folder name, in list order", () => {
    expect(resolveSitesRowHandles({ sites: [entry("alpha"), entry("Beta Site")] })).toEqual(["sites-row-alpha", "sites-row-beta-site"]);
    expect(resolveSitesRowHandles({ sites: [] })).toEqual([]);
  });
});

describe("resolveSiteListItems", () => {
  it("keys each card by its folder name and carries the whole site through", () => {
    const alpha = entry("alpha");
    expect(resolveSiteListItems({ sites: [alpha] })).toEqual([{ id: "alpha", name: "alpha", createdAt: alpha.createdAt, site: alpha }]);
    expect(resolveSiteListItems({ sites: [alpha] })[0]?.site).toBe(alpha);
  });
});

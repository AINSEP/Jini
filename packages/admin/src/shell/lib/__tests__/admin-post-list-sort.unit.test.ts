import { expect, it } from "vitest";
import { columnSortLabel, updatedColumnSortLabel } from "../admin-post-list-sort.js";

it("announces an inactive column and interpolates its literal name in translated text", () => {
  const t = (key: string) => key === "Not sorted by {columnName}. Activate to sort ascending."
    ? "Trier par {columnName} par ordre croissant." : key;
  expect(columnSortLabel({ t, columnName: "Article $&", direction: null })).toBe("Trier par Article $& par ordre croissant.");
});

it("announces that the next click on an inactive date column sorts newest first", () => {
  const t = (key: string) => key;
  expect(updatedColumnSortLabel({ t, direction: null })).toBe("Not sorted by updated date. Activate to sort newest first.");
});

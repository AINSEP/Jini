import { describe, expect, it } from "vitest";
import { interpolate, pickPlural, splitOnPlaceholders } from "../template-i18n";

describe("interpolate", () => {
  it("replaces a single token", () => {
    expect(interpolate({ template: 'Item {index} ("{code}")', vars: { index: 3, code: "ERR" } })).toBe('Item 3 ("ERR")');
  });

  it("replaces multiple distinct tokens", () => {
    expect(interpolate({ template: "{created} created, {failed} failed.", vars: { created: 5, failed: 2 } })).toBe(
      "5 created, 2 failed.",
    );
  });

  it("replaces the same token used twice", () => {
    expect(interpolate({ template: "{name} and {name} again", vars: { name: "x" } })).toBe("x and x again");
  });

  it("leaves an unmatched token untouched rather than throwing", () => {
    expect(interpolate({ template: "Hello {missing}", vars: {} })).toBe("Hello {missing}");
  });

  it("returns the template unchanged when it has no tokens", () => {
    expect(interpolate({ template: "Created", vars: { unused: "value" } })).toBe("Created");
  });
});

describe("splitOnPlaceholders", () => {
  it("splits around a single token into before/after segments", () => {
    expect(splitOnPlaceholders({ template: "Delete {file}? This cannot be undone.", tokens: ["{file}"] })).toEqual([
      "Delete ",
      "? This cannot be undone.",
    ]);
  });

  it("splits around two tokens in order into three segments", () => {
    expect(splitOnPlaceholders({ template: "Renaming {file} to {name} changes its URL.", tokens: ["{file}", "{name}"] })).toEqual([
      "Renaming ",
      " to ",
      " changes its URL.",
    ]);
  });

  it("returns the whole template as one segment when given no tokens", () => {
    expect(splitOnPlaceholders({ template: "No placeholders here.", tokens: [] })).toEqual(["No placeholders here."]);
  });

  it("degrades a missing token to an empty trailing segment instead of throwing", () => {
    expect(splitOnPlaceholders({ template: "Delete this file?", tokens: ["{file}"] })).toEqual(["Delete this file?", ""]);
  });

  it("degrades a later missing token to empty without losing the earlier match", () => {
    expect(splitOnPlaceholders({ template: "Renaming {file} to a new name.", tokens: ["{file}", "{name}"] })).toEqual([
      "Renaming ",
      " to a new name.",
      "",
    ]);
  });
});

describe("pickPlural", () => {
  it("picks the singular form for count 1", () => {
    expect(pickPlural({ count: 1, forms: { one: "1 término", other: "{count} términos" } })).toBe("1 término");
  });

  it("picks the other form for count 0", () => {
    expect(pickPlural({ count: 0, forms: { one: "1 term", other: "{count} terms" } })).toBe("{count} terms");
  });

  it("picks the other form for count greater than 1", () => {
    expect(pickPlural({ count: 5, forms: { one: "1 term", other: "{count} terms" } })).toBe("{count} terms");
  });
});

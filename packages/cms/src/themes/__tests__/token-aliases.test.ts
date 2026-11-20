import assert from "node:assert/strict";
import { test } from "vitest";
import { themeTokenAliasDeclarations } from "../token-aliases.js";

test("an alias the theme defines itself is never overridden, and an --ink theme aliases onto --ink", () => {
  assert.deepEqual(themeTokenAliasDeclarations({ tokens: { "--ink": "#111", "--text": "red", "--surface": "#fff" } }), [
    ["--text-strong", "var(--ink)"],
    ["--text-color", "var(--ink)"],
    ["--color-text", "var(--ink)"],
    ["--foreground", "var(--ink)"],
    ["--heading-color", "var(--ink)"],
    ["--surface-muted", "var(--surface)"],
  ]);
});

test("a name defined only in the light token set is still the theme's own and is not aliased", () => {
  assert.deepEqual(themeTokenAliasDeclarations({ tokens: { "--fg": "#fff" }, tokensLight: { "--text": "#000" } }), [
    ["--text-strong", "var(--fg)"],
    ["--text-color", "var(--fg)"],
    ["--color-text", "var(--fg)"],
    ["--foreground", "var(--fg)"],
    ["--heading-color", "var(--fg)"],
  ]);
});

test("a theme with none of the alias targets gets no aliases (no dangling var())", () => {
  assert.deepEqual(themeTokenAliasDeclarations({ tokens: { "--color": "red" } }), []);
});

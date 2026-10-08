import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import ts from "typescript";

import { EMBED_MARKER_TARGET_KEYS, embedMarkerTarget } from "./support/compat/markers-marker.js";
import { PAGE_EMBED_TYPES, isPageEmbedType } from "./support/compat/page-embed-types.js";

/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A1): keeps `EMBED_MARKER_TARGET_KEYS` — the
 * admin-facing table of "which key names this marker type's target" — honest against the server's own
 * page-embed resolver registry. `isPageEmbedType` and `PAGE_EMBED_TYPES` live in an import-safe leaf;
 * reading the actual `HTML_EMBED_RESOLVERS` registrations also catches drift in that leaf without
 * loading the server's DB/media services. Each registered type MUST have a matching target-key row,
 * with slug fallback only where its resolver reads a slug, or the admin placeholder would silently
 * regress to the id-only bug this plan fixes the moment a future resolver is added without a row.
 *
 * `marker.ts` is deliberately import-free (its own file header: PURE, no I/O, no DOM, no resolution) so
 * the admin can safely alias straight to it without pulling in server-only code. The last test
 * below is the boundary guard that keeps that true: it fails loudly the moment anyone adds an `import`
 * line to `marker.ts`.
 */

/** Reads a sibling source file relative to this test. */
function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * The keys of `resolver-service.ts`'s private `HTML_EMBED_RESOLVERS` literal, read from its source.
 * The registry is private. Read its top-level properties with the existing TypeScript AST library:
 * a regex ending at the first `}` truncates the list at taxonomy's nested `{ refs, deps }` argument,
 * silently omitting the media/post/content registrations that follow it.
 */
function registeredPageEmbedTypes(): string[] {
  const source = readSource("../resolver-service.ts");
  const parsed = ts.createSourceFile("resolver-service.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === "HTML_EMBED_RESOLVERS");
  let initializer = declaration?.initializer;
  assert.ok(initializer, "could not locate HTML_EMBED_RESOLVERS in resolver-service.ts");
  while (ts.isSatisfiesExpression(initializer) || ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer)) {
    initializer = initializer.expression;
  }
  assert.ok(ts.isObjectLiteralExpression(initializer), "HTML_EMBED_RESOLVERS must be an object literal");
  return initializer.properties.map((property) => {
    assert.ok(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property), "unsupported registry property; update this reader");
    assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), "registry keys must be literal type names");
    return property.name.text;
  });
}

test("marker-target parity: the registry AST finds every type in the import-safe page-embed list", () => {
  assert.deepEqual(registeredPageEmbedTypes().sort(), [...PAGE_EMBED_TYPES].sort());
});

test("marker-target parity: every server-registered page-embed type declares its resolver's target keys", () => {
  for (const type of registeredPageEmbedTypes()) {
    assert.ok(isPageEmbedType(type), `expected "${type}" to be registered in HTML_EMBED_RESOLVERS`);
    const keys = EMBED_MARKER_TARGET_KEYS[type];
    assert.ok(keys, `EMBED_MARKER_TARGET_KEYS is missing an entry for registered type "${type}"`);
    // resolveTaxonomyEmbeds reads only ref.id (an ID or a unique taxonomy name), never ref.slug.
    // The other registered resolvers, including resolveFormTypeEmbeds, read id before slug.
    assert.deepEqual(keys, type === "taxonomy" ? ["id"] : ["id", "slug"], `incorrect resolver target keys for "${type}"`);
  }
});

test("marker-target parity: form has slug fallback and taxonomy accepts only the id key", () => {
  assert.deepEqual(embedMarkerTarget("form", { slug: "contact" }), { key: "slug", value: "contact" });
  assert.deepEqual(embedMarkerTarget("form", { id: "form-id", slug: "contact" }), { key: "id", value: "form-id" });
  assert.deepEqual(embedMarkerTarget("taxonomy", { id: "Categories", slug: "categories" }), { key: "id", value: "Categories" });
  assert.equal(embedMarkerTarget("taxonomy", { slug: "categories" }), undefined);
});

test("marker-target parity: the target-value length bound matches html-embeds.ts's MAX_EMBED_ID_LENGTH", () => {
  const source = readSource("../html/html-embeds.ts");
  const bound = Number(/const MAX_EMBED_ID_LENGTH = (\d+);/.exec(source)?.[1]);
  assert.ok(Number.isInteger(bound) && bound > 0, "could not read MAX_EMBED_ID_LENGTH from html-embeds.ts");

  assert.deepEqual(embedMarkerTarget("widget", { slug: "s".repeat(bound) }), { key: "slug", value: "s".repeat(bound) });
  assert.equal(embedMarkerTarget("widget", { slug: "s".repeat(bound + 1) }), undefined);
});

test("marker.ts stays import-free so the admin's alias never pulls in server-only code", () => {
  const source = readSource("../markers/marker.ts");

  const parsed = ts.createSourceFile("marker.ts", source, ts.ScriptTarget.Latest, true);
  const dependencies: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) dependencies.push(node.getText(parsed));
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) dependencies.push(node.getText(parsed));
    if (ts.isImportEqualsDeclaration(node)) dependencies.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.deepEqual(dependencies, [], "marker must not acquire a dependency through imports or re-exports");
});

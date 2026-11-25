import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";
import { isKnownPermission, listPermissions } from "../index.js";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.name === "__tests__") return [];
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

function readModuleEdges(
  { source, file }: { source: string; file: string },
  _optional: Record<string, never> = {},
): { specifier: string; typeOnly: boolean }[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges: { specifier: string; typeOnly: boolean }[] = [];
  function check(node: ts.Node): void {
    let specifier: string | undefined;
    let typeOnly = false;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier.text;
      typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require")) {
      const argument = node.arguments[0];
      expect(argument && ts.isStringLiteral(argument), file).toBe(true);
      if (argument && ts.isStringLiteral(argument)) specifier = argument.text;
    }
    if (specifier) {
      expect(specifier, file).not.toMatch(/^(?:react|react-dom)(?:\/|$)|^@jini-ai\/(?:cms|admin|mcp|ui)(?:\/|$)/);
      edges.push({ specifier, typeOnly });
    }
    ts.forEachChild(node, check);
  }
  check(ast);
  return edges;
}

function isAllowedPasskeyTypeEdge(
  { specifier, typeOnly }: { specifier: string; typeOnly: boolean },
  _optional: Record<string, never> = {},
): boolean {
  if (specifier !== "@jini-ai/core/contracts/site/user-management-react" || !typeOnly) return false;
  // The subpath name indicates who consumes the DTO, not what code it loads.
  const file = resolve(sourceRoot, "../../core/src/contracts/site/user-management-react.ts");
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    expect(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.isTypeOnly), file).toBe(true);
  }
  function check(node: ts.Node): void {
    expect(ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node), file).toBe(false);
    if (ts.isCallExpression(node)) {
      expect(node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require", file).toBe(false);
    }
    ts.forEachChild(node, check);
  }
  check(ast);
  return true;
}

test("accepts the canonical type-only passkey contract without treating it as React", () => {
  const edges = readModuleEdges({
    source: 'export type { PasskeyOptions } from "@jini-ai/core/contracts/site/user-management-react"',
    file: "fixture.ts",
  });
  expect(edges).toEqual([{ specifier: "@jini-ai/core/contracts/site/user-management-react", typeOnly: true }]);
  expect(isAllowedPasskeyTypeEdge(edges[0]!)).toBe(true);
});

test("rejects React imports and value imports of the passkey contract", () => {
  const [edge] = readModuleEdges({
    source: 'import { PasskeyOptions } from "@jini-ai/core/contracts/site/user-management-react"',
    file: "fixture.ts",
  });
  expect(isAllowedPasskeyTypeEdge(edge!)).toBe(false);
  for (const specifier of ["react", "react/jsx-runtime", "@jini-ai/admin/media"]) {
    expect(() => readModuleEdges({ source: `import value from "${specifier}"`, file: "fixture.ts" })).toThrow();
  }
});

test("all headless production source stays independent of host and UI packages", () => {
  const files = ["core", "server"].flatMap((entry) => sourceFiles(resolve(sourceRoot, entry)));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    readModuleEdges({ source, file });
  }
});

test("the entire universal import graph excludes Node, React, and server modules", () => {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    expect(file).not.toContain("/server/");
    for (const edge of readModuleEdges({ source: readFileSync(file, "utf8"), file })) {
      const { specifier } = edge;
      if (specifier === "@jini-ai/core/primitives") {
        // Canonical primitives moved into core; inspect their graph rather than bypassing it.
        visit(resolve(sourceRoot, "../../core/src/primitives/index.ts"));
      } else if (!isAllowedPasskeyTypeEdge(edge)) {
        expect(specifier, file).toMatch(/^\./);
        visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
  }
  visit(resolve(sourceRoot, "core/index.ts"));
});

test("the universal catalog contains built-in feature permissions without registration side effects", () => {
  for (const id of ["user.manage", "role.manage", "admin.menus.read", "media.upload", "workspace.manage"]) expect(isKnownPermission({ id: id }), id).toBe(true);
  expect(isKnownPermission({ id: "*" })).toBe(false);
  expect(new Set(listPermissions({}).map((permission) => permission.id)).size).toBe(listPermissions({}).length);
});

test("every built-in descriptor retains the captured source order and value", () => {
  const fixture = JSON.parse(readFileSync(new URL("./builtins.fixture.json", import.meta.url), "utf8")) as { permissions: unknown };
  expect(listPermissions({})).toEqual(fixture.permissions);
});

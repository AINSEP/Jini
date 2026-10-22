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

test("all headless production source stays independent of host and UI packages", () => {
  const files = ["core", "server"].flatMap((entry) => sourceFiles(resolve(sourceRoot, entry)));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/@jini-ai\/(?:cms|admin|mcp|ui)(?:[\/"']|$)|\breact(?:[\/"']|$)/i);
  }
});

test("the entire universal import graph excludes Node, React, and server modules", () => {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    expect(file).not.toContain("/server/");
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function check(node: ts.Node): void {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require")) {
        const argument = node.arguments[0];
        expect(argument && ts.isStringLiteral(argument), file).toBe(true);
        if (argument && ts.isStringLiteral(argument)) specifier = argument.text;
      }
      if (specifier) {
        if (specifier === "@jini-ai/core/primitives") {
          // Canonical primitives moved into core; inspect their graph rather than bypassing it.
          visit(resolve(sourceRoot, "../../core/src/primitives/index.ts"));
        } else {
          expect(specifier, file).toMatch(/^\./);
          visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
        }
      }
      ts.forEachChild(node, check);
    }
    check(ast);
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

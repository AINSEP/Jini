/** Import boundaries are syntax rules; use TypeScript's parser and test the scanner itself. */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const drivers = ["better-sqlite3", "pg", "@electric-sql/pglite"];

function violations(file: string, source: string): string[] {
  const problems: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function check(specifier: string, typeOnly: boolean) {
    const is = (name: string) => specifier === name || specifier.startsWith(`${name}/`);
    if (is("kysely") && !/^(kernel|migrate)\//.test(file)) problems.push(`kysely outside kernel/migrate: ${specifier}`);
    if (drivers.some(is) && !typeOnly) problems.push(`runtime driver: ${specifier}`);
    if (is("@electric-sql/pglite") && typeOnly && !/^(pglite|kernel\/pglite)\//.test(file)) {
      problems.push(`PGlite types outside pglite: ${specifier}`);
    }
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly === true || (!!clause && !clause.name && !!bindings &&
        ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly));
      check(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const typeOnly = node.isTypeOnly || (!!clause && ts.isNamedExports(clause) &&
        clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly));
      check(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) check(specifier.text, false);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      check(node.argument.literal.text, true);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return problems;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "__tests__") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("database import isolation", () => {
  it("scans every production TypeScript file and confines optional dependencies", () => {
    const files = sourceFiles(sourceRoot);
    expect(files).toContain(join(sourceRoot, "postgres/types.ts"));
    expect(files).toContain(join(sourceRoot, "pglite/owner.ts"));
    expect(files).toContain(join(sourceRoot, "kernel/port.ts"));
    expect(files.flatMap(file => violations(relative(sourceRoot, file), readFileSync(file, "utf8")).map(v => `${file}: ${v}`))).toEqual([]);
  });

  it.each([
    ['sqlite/bad.ts', 'import type { Kysely } from "kysely";', 'kysely outside kernel/migrate: kysely'],
    ['core/bad.ts', 'export { sql } from "kysely";', 'kysely outside kernel/migrate: kysely'],
    ['postgres/bad.ts', 'const m = import("kysely");', 'kysely outside kernel/migrate: kysely'],
    ['kernel/bad.ts', 'import Database from "better-sqlite3";', 'runtime driver: better-sqlite3'],
    ['kernel/bad.ts', 'export * from "pg";', 'runtime driver: pg'],
    ['kernel/bad.ts', 'const m = import("@electric-sql/pglite");', 'runtime driver: @electric-sql/pglite'],
    ['core/bad.ts', 'import type { PGlite } from "@electric-sql/pglite";', 'PGlite types outside pglite: @electric-sql/pglite'],
    ['core/bad.ts', 'export type { PGlite } from "@electric-sql/pglite";', 'PGlite types outside pglite: @electric-sql/pglite'],
    ['postgres/bad.ts', 'type T = import("@electric-sql/pglite").PGlite;', 'PGlite types outside pglite: @electric-sql/pglite'],
    ['kernel/bad.ts', 'import { type Pool, default as pg } from "pg";', 'runtime driver: pg'],
  ])("POSITIVE CONTROL: catches %s containing %s", (file, source, expected) => {
    expect(violations(file, source)).toContain(expected);
  });

  it.each([
    ["transfer/bad.ts", 'import { sql } from "kysely";'],
    ["tools/bad.ts", 'import type { Kysely } from "kysely";'],
  ])("transfer/tools cannot load Kysely: %s", (file, source) => {
    expect(violations(file, source)).toContain("kysely outside kernel/migrate: kysely");
  });

  it("permits only the specified type-only imports and ignores comments and string lookalikes", () => {
    expect(violations("kernel/pglite/ok.ts", 'import { type PGlite } from "@electric-sql/pglite"; export type { PGlite } from "@electric-sql/pglite"; import { sql } from "kysely";')).toEqual([]);
    expect(violations("core/ok.ts", '// import pg from "pg";\nconst text = `import("kysely")`;')).toEqual([]);
  });
});

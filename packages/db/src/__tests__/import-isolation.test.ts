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
    // The vault is a typed SQL repo over kernel.run, with JSON patches and binary promotion
    // ordering. Keep its Kysely query body here rather than adding vault policy to the kernel.
    // This exact-file allowance grants no driver access and does not cover other vault modules.
    if (is("kysely") && !/^(kernel|migrate)\//.test(file) && file !== "secrets-vault/repo.sql.ts") problems.push(`kysely outside kernel/migrate: ${specifier}`);
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

  it("SQL vault persistence imports platform only through the contracts leaf", () => {
    const file = join(sourceRoot, "secrets-vault/repo.sql.ts");
    const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const platformImports = tree.statements.flatMap(statement =>
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text.startsWith("@jini-ai/platform")
        ? [statement.moduleSpecifier.text] : []);
    expect(platformImports).toEqual(["@jini-ai/platform/secrets/credential-sets/contracts"]);
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
    ["secrets-vault/bad.ts", 'import { sql } from "kysely";'],
  ])("transfer/tools/vault siblings cannot load Kysely: %s", (file, source) => {
    expect(violations(file, source)).toContain("kysely outside kernel/migrate: kysely");
  });

  it("permits the narrow SQL/type imports and ignores comments and string lookalikes", () => {
    expect(violations("secrets-vault/repo.sql.ts", 'import { sql, type Kysely } from "kysely";')).toEqual([]);
    expect(violations("secrets-vault/repo.sql.ts", 'import Database from "better-sqlite3";')).toEqual(["runtime driver: better-sqlite3"]);
    expect(violations("kernel/pglite/ok.ts", 'import { type PGlite } from "@electric-sql/pglite"; export type { PGlite } from "@electric-sql/pglite"; import { sql } from "kysely";')).toEqual([]);
    expect(violations("core/ok.ts", '// import pg from "pg";\nconst text = `import("kysely")`;')).toEqual([]);
  });
});

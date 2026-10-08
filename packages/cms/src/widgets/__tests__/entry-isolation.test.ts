import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import ts from "typescript";

const DOMAIN = fileURLToPath(new URL("../", import.meta.url));
const CMS = resolve(DOMAIN, "..");

/** Read runtime imports/re-exports, dynamic imports and require calls; erased type edges do not load. */
function runtimeSpecifiers(source: string): string[] {
  const ast = ts.createSourceFile("entry.ts", source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      assert.equal(node.arguments.length, 1, "runtime dependencies must be statically enumerable");
      assert.ok(node.arguments[0]);
      assert.ok(ts.isStringLiteral(node.arguments[0]), "computed runtime dependencies must be reviewed explicitly");
      specifiers.push(node.arguments[0].text);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      assert.ok(node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression));
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return specifiers;
}

function closure(entry: string): { files: string[]; external: string[] } {
  const visited = new Set<string>();
  const external = new Set<string>();
  const pending = [resolve(DOMAIN, entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      else external.add(specifier);
    }
  }
  return { files: [...visited].map((file) => relative(CMS, file)), external: [...external] };
}

test("widgets markers, root and resolvers have isolated universal runtime closures", () => {
  for (const entry of ["markers/index.ts", "index.ts", "resolvers/index.ts"]) {
    const result = closure(entry);
    assert.deepEqual(result.external.filter((name) => /^(?:parse5|kysely|express)(?:\/|$)|^node:|^@jini-ai\/db(?:\/|$)/.test(name)), [], entry);
    assert.deepEqual(result.files.filter((file) => !file.startsWith("widgets/") && !file.startsWith("core/")), [], entry);
    assert.deepEqual(result.files.filter((file) => /^widgets\/(?:sql|html)\//.test(file)), [], entry);
  }
});

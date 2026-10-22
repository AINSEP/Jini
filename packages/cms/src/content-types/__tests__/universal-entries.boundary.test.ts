import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packagesRoot = dirname(packageRoot);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

type Manifest = {
  exports: Record<string, string | { import: string }>;
  jini: { entries: Record<string, string> };
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
};

/** Parse actual module edges, ignoring comments, strings and erased type-only references. */
function runtimeDependencies(source: string): string[] {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true);
  const dependencies: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTypeNode(node)) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly);
      if (!clause?.isTypeOnly && !(onlyNamedTypes && !clause?.name)) dependencies.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const onlyNamedTypes = clause && ts.isNamedExports(clause) && clause.elements.length > 0
        && clause.elements.every((element) => element.isTypeOnly);
      if (!node.isTypeOnly && !onlyNamedTypes) dependencies.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) dependencies.push(expression.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (!argument || !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        throw new Error("Universal-entry guard cannot resolve a computed runtime import");
      }
      dependencies.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return dependencies;
}

/** Follow runtime imports/re-exports transitively, once per module, including cyclic graphs. */
function reachableBuiltins(entry: string, load: (path: string) => string, resolveImport: (from: string, specifier: string) => string): string[] {
  const visited = new Set<string>();
  const violations: string[] = [];
  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    for (const specifier of runtimeDependencies(load(path))) {
      if (specifier.startsWith("node:") || builtins.has(specifier)) violations.push(`${path} -> ${specifier}`);
      else visit(resolveImport(path, specifier));
    }
  }
  visit(entry);
  return violations;
}

function sourcePath(path: string): string {
  const stem = path.replace(/\.[cm]?js$/, "");
  const candidates = [path, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, resolve(path, "index.ts")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Missing source for universal-entry edge: ${path}`);
  return found;
}

// Resolve workspace export maps to source, never stale dist output or node_modules symlinks.
function exportedSource(root: string, subpath: string): string {
  const manifest: Manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const entry = manifest.exports[subpath];
  if (!entry) throw new Error(`Missing export ${subpath} in ${root}`);
  const target = typeof entry === "string" ? entry : entry.import;
  return sourcePath(resolve(root, target.replace(/^\.\/dist\//, "./src/")));
}

function resolveRuntimeImport(from: string, specifier: string): string {
  if (specifier.startsWith(".")) return sourcePath(resolve(dirname(from), specifier));
  if (specifier.startsWith("@jini-ai/")) {
    const [packageName, ...segments] = specifier.slice("@jini-ai/".length).split("/");
    if (!packageName) throw new Error(`Invalid workspace import: ${specifier}`);
    return exportedSource(resolve(packagesRoot, packageName), segments.length ? `./${segments.join("/")}` : ".");
  }
  throw new Error(`Unresolved universal-entry dependency: ${from} -> ${specifier}`);
}

const manifest: Manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const universalEntries = Object.entries(manifest.jini.entries).filter(([, runtime]) => runtime === "universal");

// REGRESSION: the folded domains use verified-origin; keep its peer optional and publishable,
// rather than restoring "workspace:*" to peerDependencies or requiring it for unrelated entries.
test("CMS declares the used HTTP toolkit peer with an optional registry range", () => {
  expect(manifest.peerDependencies?.["@jini-ai/http-kit"]).toBe("^0.4.0");
  expect(manifest.peerDependenciesMeta?.["@jini-ai/http-kit"]).toEqual({ optional: true });
});

// REGRESSION: fails if index-provisioning.ts restores import { createHash } from "node:crypto".
test("no CMS universal entry reaches a Node builtin", () => {
  expect(manifest.jini.entries["./content-types"]).toBe("universal");
  expect(universalEntries.length).toBeGreaterThan(0);
  const violations = universalEntries.flatMap(([entry]) =>
    reachableBuiltins(exportedSource(packageRoot, entry), (path) => readFileSync(path, "utf8"), resolveRuntimeImport)
      .map((violation) => `${entry}: ${violation}`),
  );
  expect(violations).toEqual([]);
});

// PARITY
test("guard follows re-exports and dynamic imports through cycles while ignoring type-only imports", () => {
  const files: Record<string, string> = {
    entry: 'import type { Buffer } from "node:buffer"; export * from "middle";',
    middle: 'export * from "entry"; import("leaf");',
    leaf: 'import "node:crypto";',
  };
  expect(reachableBuiltins("entry", (path) => files[path]!, (_from, specifier) => specifier))
    .toEqual(["leaf -> node:crypto"]);
});

// PARITY
test("guard separates runtime edges from type-only edges and ordinary node-like strings", () => {
  expect(runtimeDependencies(`
    import { type Buffer } from "node:buffer";
    export type { Stats } from "node:fs";
    export { type URL } from "node:url";
    type Crypto = import("node:crypto").Hash;
    const description = "node:crypto";
    // import "node:fs";
    import "node:path";
    export * from "child";
    require("node:os");
  `)).toEqual(["node:path", "child", "node:os"]);
});

// PARITY
test("guard rejects computed module edges rather than silently skipping them", () => {
  expect(() => runtimeDependencies("import(moduleName)")).toThrow("computed runtime import");
});

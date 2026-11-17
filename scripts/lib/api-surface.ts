/**
 * Public-API surface extraction + diff for published `@jini-ai/*` packages.
 *
 * Pure logic lives here (tested in scripts/__tests__/api-surface.test.ts); the CLI is
 * scripts/check-api-surface.ts. Uses the TypeScript compiler API only (already a devDependency).
 *
 * A package's surface = for every `package.json` `exports` subpath: the subpath itself, plus (for
 * subpaths that resolve to a `.d.ts`) every exported symbol with its kind and a hash of its
 * comment-stripped declaration text. A symbol whose own declaration changes shows as `changed`;
 * a change inside a type it merely *references* by name is not seen (see cloud-results notes).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

export interface EntrySurface {
  /** Resolved declaration file, relative to the package dir; `null` for asset/JS-only subpaths. */
  types: string | null;
  /** symbol name -> `kind:hash` */
  symbols: Record<string, string>;
}
export type PackageSurface = Record<string, EntrySurface>;

export interface SurfaceDiff {
  removedSubpaths: string[];
  addedSubpaths: string[];
  removedSymbols: string[]; // "subpath#name"
  addedSymbols: string[];
  changedSymbols: string[];
}

const CONDITION_ORDER = ["types", "import", "default", "require"];

/** First string target for the given condition priority, skipping nested non-matching branches. */
export function pickTarget({ value, wantTypes }: { value: unknown; wantTypes: boolean }, _optional = {}): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const order = wantTypes ? CONDITION_ORDER : CONDITION_ORDER.filter((c) => c !== "types");
  for (const key of order) {
    if (key in obj) {
      const hit = pickTarget({ value: obj[key], wantTypes });
      if (hit) return hit;
    }
  }
  return null;
}

/** Map an `exports` target to its `.d.ts`, or `null` when the target is an asset / has no types. */
export function resolveTypesFile({ pkgDir, value }: { pkgDir: string; value: unknown }, _optional = {}): string | null {
  const target = pickTarget({ value, wantTypes: true });
  if (!target || target.includes("*")) return null;
  let cand: string | null = null;
  if (/\.d\.[cm]?ts$/.test(target)) cand = target;
  else if (/\.[cm]?js$/.test(target)) cand = target.replace(/\.([cm]?)js$/, ".d.$1ts");
  if (!cand) return null;
  return existsSync(join(pkgDir, cand)) ? cand : null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

function kindOf(sym: ts.Symbol): string {
  const f = sym.flags;
  const parts: string[] = [];
  if (f & ts.SymbolFlags.Class) parts.push("class");
  if (f & ts.SymbolFlags.Interface) parts.push("interface");
  if (f & ts.SymbolFlags.TypeAlias) parts.push("type");
  if (f & ts.SymbolFlags.Enum) parts.push("enum");
  if (f & ts.SymbolFlags.Function) parts.push("function");
  if (f & ts.SymbolFlags.Variable) parts.push("variable");
  if (f & ts.SymbolFlags.Module && !parts.length) parts.push("namespace");
  return parts.join("+") || "unknown";
}

/** Extract exported symbols of the given `.d.ts` entry files in one program (shared checker). */
export function extractSymbols(
  { pkgDir, files }: { pkgDir: string; files: string[] },
  _optional = {},
): Record<string, Record<string, string>> {
  const roots = files.map((f) => resolve(pkgDir, f));
  const program = ts.createProgram(roots, {
    noEmit: true,
    skipLibCheck: true,
    allowJs: false,
    types: [],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.Preserve,
  });
  const checker = program.getTypeChecker();
  const printer = ts.createPrinter({ removeComments: true });
  const out: Record<string, Record<string, string>> = {};
  for (const [i, root] of roots.entries()) {
    const sf = program.getSourceFile(root);
    const res: Record<string, string> = {};
    const modSym = sf && checker.getSymbolAtLocation(sf);
    if (sf && modSym) {
      for (const exp of checker.getExportsOfModule(modSym)) {
        const target = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
        const decls = (target.declarations ?? []).filter((d) => !ts.isSourceFile(d));
        const text = decls
          .map((d) => printer.printNode(ts.EmitHint.Unspecified, d, d.getSourceFile()))
          .map((t) => t.replace(/\s+/g, " "))
          .join("\n");
        // unresolved re-export of an external module => target has no decls; record its kind only
        res[exp.name] = `${kindOf(target)}:${hash(text)}`;
      }
    }
    out[files[i]!] = res;
  }
  return out;
}

export function buildPackageSurface({ pkgDir, exportsField }: { pkgDir: string; exportsField: unknown }, _optional = {}): PackageSurface {
  const surface: PackageSurface = {};
  if (typeof exportsField === "string" || Array.isArray(exportsField)) exportsField = { ".": exportsField };
  const entries = Object.entries((exportsField ?? {}) as Record<string, unknown>);
  const typesBySub = new Map<string, string | null>();
  for (const [sub, val] of entries) typesBySub.set(sub, resolveTypesFile({ pkgDir, value: val }));
  const uniq = [...new Set([...typesBySub.values()].filter((v): v is string => !!v))];
  const symbols = uniq.length ? extractSymbols({ pkgDir, files: uniq }) : {};
  for (const [sub] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const t = typesBySub.get(sub) ?? null;
    surface[sub] = { types: t, symbols: t ? sortKeys(symbols[t] ?? {}) : {} };
  }
  return surface;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function diffSurface({ base, cur }: { base: PackageSurface; cur: PackageSurface }, _optional = {}): SurfaceDiff {
  const d: SurfaceDiff = {
    removedSubpaths: [], addedSubpaths: [], removedSymbols: [], addedSymbols: [], changedSymbols: [],
  };
  for (const sub of Object.keys(base)) if (!(sub in cur)) d.removedSubpaths.push(sub);
  for (const sub of Object.keys(cur)) if (!(sub in base)) d.addedSubpaths.push(sub);
  for (const sub of Object.keys(base)) {
    const c = cur[sub];
    if (!c) continue;
    const b = base[sub]!;
    for (const [name, sig] of Object.entries(b.symbols)) {
      if (!(name in c.symbols)) d.removedSymbols.push(`${sub}#${name}`);
      else if (c.symbols[name] !== sig) d.changedSymbols.push(`${sub}#${name}`);
    }
    for (const name of Object.keys(c.symbols))
      if (!(name in b.symbols)) d.addedSymbols.push(`${sub}#${name}`);
  }
  return d;
}

export const isBreaking = ({ diff }: { diff: SurfaceDiff }, _optional = {}) => diff.removedSubpaths.length + diff.removedSymbols.length > 0;

/** Parse changeset frontmatter -> map package -> highest bump seen. */
export function parseChangesetBumps({ md }: { md: string }, _optional = {}): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1]!.split(/\r?\n/)) {
    const k = /^\s*["']?([^"':]+?)["']?\s*:\s*["']?(major|minor|patch)["']?\s*$/.exec(line);
    if (k) out[k[1]!] = k[2]!;
  }
  return out;
}

/** The rule: a breaking diff is covered iff a pending changeset bumps this package major/minor. */
export function coveredByChangeset({ pkgName, changesets }: { pkgName: string; changesets: string[] }, _optional = {}): boolean {
  return changesets.some((md) => {
    const bump = parseChangesetBumps({ md })[pkgName];
    return bump === "major" || bump === "minor";
  });
}

export const baselineFileName = ({ pkgName }: { pkgName: string }, _optional = {}) => pkgName.replace(/^@/, "").replace("/", "__") + ".json";

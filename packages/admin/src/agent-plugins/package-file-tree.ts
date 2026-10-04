/**
 * @file Pure helpers behind `PackageFilesModal`'s VS Code-style file tree (2026-09-29): folding a
 * package's flat `relativePath` list into folders, flattening the tree into the rows currently
 * visible for a given expansion, which rows a keyboard key moves to, and each file's icon.
 *
 * No React here — `hooks/use-package-file-tree.hooks.ts` holds the expansion and focus state and
 * calls these; the component only renders the rows it gets back.
 */

export interface PackageFileTreeFolder {
  readonly kind: "folder";
  readonly name: string;
  /** Package-relative folder path, no trailing slash (`skills/deploy`). */
  readonly path: string;
  readonly children: readonly PackageFileTreeNode[];
}

export interface PackageFileTreeFile {
  readonly kind: "file";
  readonly name: string;
  /** The file's full `relativePath`, as the listing gave it. */
  readonly path: string;
}

export type PackageFileTreeNode = PackageFileTreeFolder | PackageFileTreeFile;

/** One rendered row of the tree: a node plus where it sits, for `aria-level`/`-setsize`/`-posinset`
 *  and the indentation guides. */
export interface PackageFileTreeRow {
  readonly node: PackageFileTreeNode;
  /** 0 for the package root's own entries. */
  readonly depth: number;
  /** The containing folder's path, `null` at the root. */
  readonly parentPath: string | null;
  readonly setSize: number;
  /** 1-based, as `aria-posinset` wants. */
  readonly posInSet: number;
}

interface MutableFolder {
  readonly folders: Map<string, MutableFolder>;
  /** Name plus the path exactly as listed. */
  readonly files: { readonly name: string; readonly path: string }[];
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Files first, then folders, each alphabetical (owner's call, 2026-09-29 — VS Code's default is the reverse). */
function compareNodes(a: PackageFileTreeNode, b: PackageFileTreeNode): number {
  if (a.kind !== b.kind) return a.kind === "file" ? -1 : 1;
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function freeze(folder: MutableFolder, prefix: string): PackageFileTreeNode[] {
  const nodes: PackageFileTreeNode[] = [];
  for (const [name, child] of folder.folders) {
    const path = prefix ? `${prefix}/${name}` : name;
    nodes.push({ kind: "folder", name, path, children: freeze(child, path) });
  }
  for (const file of folder.files) nodes.push({ kind: "file", ...file });
  return nodes.sort(compareNodes);
}

/**
 * Groups flat package-relative paths into a folder tree. Empty segments (a leading, trailing or
 * doubled `/`) are ignored for grouping, so a stray slash can never produce a nameless folder; the
 * file node still carries the path exactly as listed, since that is what selection is keyed by.
 *
 * @complexity O(n·d + n log n) for n paths of depth d.
 */
export function buildPackageFileTree({ paths }: { paths: readonly string[] }, _optional = {}): PackageFileTreeNode[] {
  const root: MutableFolder = { folders: new Map(), files: [] };
  const seen = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;
    let folder = root;
    for (const segment of segments) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = { folders: new Map(), files: [] };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    const normalized = [...segments, fileName].join("/");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    folder.files.push({ name: fileName, path });
  }
  return freeze(root, "");
}

/**
 * The path of the tree's top file row once every folder on the way is open — the first file in
 * display order (files before folders, so a root file wins over anything nested); `null` for no files.
 * @complexity O(nodes).
 */
export function firstPackageFilePath({ nodes }: { nodes: readonly PackageFileTreeNode[] }, _optional = {}): string | null {
  for (const node of nodes) {
    const path = node.kind === "file" ? node.path : firstPackageFilePath({ nodes: node.children });
    if (path !== null) return path;
  }
  return null;
}

/**
 * Every folder path that contains `filePath` — the folders that start expanded so the selected
 * file is visible when the dialog opens.
 * @example ancestorFolderPaths("skills/deploy/SKILL.md") // ["skills", "skills/deploy"]
 * @complexity O(d).
 */
export function ancestorFolderPaths({ filePath }: { filePath: string }, _optional = {}): string[] {
  const segments = filePath.split("/").filter(Boolean);
  segments.pop();
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

/**
 * The rows on screen, top to bottom: a collapsed folder's descendants are left out.
 * @complexity O(visible rows).
 */
export function visiblePackageFileRows(
  { nodes, isExpanded }: { nodes: readonly PackageFileTreeNode[]; isExpanded: (required: { path: string }) => boolean },
  _optional = {},
): PackageFileTreeRow[] {
  const rows: PackageFileTreeRow[] = [];
  const walk = (level: readonly PackageFileTreeNode[], depth: number, parentPath: string | null) => {
    level.forEach((node, index) => {
      rows.push({ node, depth, parentPath, setSize: level.length, posInSet: index + 1 });
      if (node.kind === "folder" && isExpanded({ path: node.path })) walk(node.children, depth + 1, node.path);
    });
  };
  walk(nodes, 0, null);
  return rows;
}

/** What one key press in the tree does. Every field is optional; an empty object means "not ours". */
export interface PackageFileTreeKeyAction {
  /** Row path to move keyboard focus to. */
  readonly focus?: string;
  /** Folder to expand (`true`) or collapse (`false`). */
  readonly setExpanded?: { readonly path: string; readonly expanded: boolean };
  /** File to open in the content pane. */
  readonly open?: string;
}

/**
 * The WAI-ARIA tree keyboard pattern, as VS Code's explorer does it: Up/Down move, Home/End jump,
 * Right expands a closed folder or steps into an open one, Left collapses an open folder or steps
 * out to the parent, Enter/Space opens a file or toggles a folder.
 *
 * @param rows The visible rows, from {@link visiblePackageFileRows}.
 * @param currentPath The focused row's path.
 * @complexity O(rows).
 */
export function packageFileTreeKeyAction(
  { rows, currentPath, key, isExpanded }: { rows: readonly PackageFileTreeRow[]; currentPath: string; key: string; isExpanded: (required: { path: string }) => boolean },
  _optional = {},
): PackageFileTreeKeyAction {
  if (rows.length === 0) return {};
  const index = Math.max(
    0,
    rows.findIndex((row) => row.node.path === currentPath),
  );
  const row = rows[index]!;
  const node = row.node;
  const open = node.kind === "folder" && isExpanded({ path: node.path });
  switch (key) {
    case "ArrowDown":
      return { focus: rows[Math.min(index + 1, rows.length - 1)]!.node.path };
    case "ArrowUp":
      return { focus: rows[Math.max(index - 1, 0)]!.node.path };
    case "Home":
      return { focus: rows[0]!.node.path };
    case "End":
      return { focus: rows[rows.length - 1]!.node.path };
    case "ArrowRight":
      if (node.kind !== "folder") return { focus: node.path };
      if (!open) return { focus: node.path, setExpanded: { path: node.path, expanded: true } };
      return { focus: rows[index + 1]?.parentPath === node.path ? rows[index + 1]!.node.path : node.path };
    case "ArrowLeft":
      if (open) return { focus: node.path, setExpanded: { path: node.path, expanded: false } };
      return { focus: row.parentPath ?? node.path };
    case "Enter":
    case " ":
      if (node.kind === "file") return { focus: node.path, open: node.path };
      return { focus: node.path, setExpanded: { path: node.path, expanded: !open } };
    default:
      return {};
  }
}

/** Icon family for a file row; the component maps it to a RemixIcon glyph and a tint. */
export type PackageFileIconKind =
  | "json"
  | "markdown"
  | "javascript"
  | "typescript"
  | "config"
  | "html"
  | "css"
  | "image"
  | "shell"
  | "text"
  | "file";

const ICON_KIND_BY_EXTENSION: Readonly<Record<string, PackageFileIconKind>> = {
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  yml: "config",
  yaml: "config",
  toml: "config",
  ini: "config",
  env: "config",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  ico: "image",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  txt: "text",
  log: "text",
};

/**
 * Picks a file's icon family from its extension (the text after the last `.`, case-insensitive).
 * A dotfile with no other dot (`.env`) counts its whole name as the extension.
 * @complexity O(name length).
 */
export function packageFileIconKind({ fileName }: { fileName: string }, _optional = {}): PackageFileIconKind {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "file";
  return ICON_KIND_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? "file";
}

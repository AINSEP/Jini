
/** The secret scanner a host injects into {@link checkTreeFiles}: given a text sample, the hits it found
 *  (empty when clean). Structural so this package never imports a scanner implementation; only the first
 *  hit's `patternName` is read. */
export type TextSecretScanner = (input: { text: string }) => readonly { readonly patternName: string }[];

/**
 * @file `publish-files-plan-2026-09-24.md` §2 — the one pure module every file-tree publish type
 * (`theme-files` today; `agent-skill`/`agent-plugin`/`site-plugin` later) filters through, on BOTH
 * sides of a publish: the source decides what it is willing to pack, and the destination re-runs the
 * identical check in `precheck` because it never trusts the source's own filtering (that file's §3
 * step 1). One module, one set of rules, so the two can never drift apart.
 *
 * ## Why a tree is blocked WHOLE, never trimmed
 *
 * A theme (or skill, or plugin) is one thing an operator recognizes and one thing that must swap
 * atomically (§0's own reasoning for why a whole tree, not one file, is the publish unit). Silently
 * dropping the one file that failed a check would ship a theme missing a file it depends on — broken
 * in a way nothing surfaces until a page 404s. Every check in this module therefore reports one
 * blocking reason for the WHOLE tree, never a per-file skip list.
 *
 * ## What this module does NOT decide
 *
 * - Which files belong to one theme's tree at all (excluding `__original-themes__/`, `README.md`,
 *   generated build output) — that is `pack()`'s own walk (`features/theme/publish-content.ts`,
 *   S-F3), the same way `site-backup/sources.ts`'s `walkTree` decides its own scope before this kind
 *   of check would even apply.
 * - The human-facing "<title> was not published: ..." sentence — every reason this module returns
 *   names the offending path/fact only; the caller (which knows the tree's display title) prefixes
 *   it. Keeping the title out of this module is what lets `checkTreeFiles` stay a pure function of
 *   `(kind, files)`, with no caller-specific wording to keep in sync.
 *
 *   One exception: the disallowed-extension reason (the most common real refusal — a stray video or
 *   other unpublishable file dropped into a theme folder) is returned already final, via
 *   {@link wrapTreePolicyReason}'s sentinel, and a caller must pass every `checkTreeFiles` reason
 *   through that function rather than concatenating a title itself. The row already shows the tree's
 *   title in its own label column, so `"Theme: x was not published: ... has a file type ('mp4') that
 *   is not allowed for this tree"` repeated the label and read as an internal validator message, not
 *   something an operator asked for. Every other reason in this module (path shape, deny-list, caps,
 *   secret scan) is unaffected and still gets the title prefix.
 */

/** Every file-tree publish type this policy module knows about, per §1's inventory table. Only
 *  `theme-files` has a real contributor yet (S-F3/S-F4) — the other three are declared here now so
 *  the shape is fixed once, and the static test in this module's own `__tests__/` pins that this set
 *  never shrinks or silently gains an unreviewed 5th kind. */
export type FileTreeKind = "theme-files" | "agent-skill" | "agent-plugin" | "site-plugin";

/** One kind's static shape: `baseDir` is the fixed, non-configurable first path segment under the
 *  site root (§2's own inventory paths) — never itself a caller-chosen value, which is what makes
 *  {@link resolveTreeRelativePath}'s output structurally unable to ever equal a bare site-root
 *  filename (`config.json`, `.site-meta.json`, ...): every resolved path is `${baseDir}/...`, and no
 *  site-root file name contains a `/`. `idSegmentCount` is how many further, tree-address-choosing
 *  segments follow (theme-files: tier + id; agent-skill: workspace + id; site-plugin: id + version).
 *  `allowedExtensions` is `null` for a code-class kind (§2: "Code-class kinds allow any extension"). */
export interface FileTreeKindSpec {
  readonly baseDir: string;
  readonly idSegmentCount: number;
  readonly allowedExtensions: readonly string[] | null;
}

/** §2's extension allow-list for `theme-files` — any file whose extension is not on this list blocks
 *  the whole tree (never silently dropped; see this file's header). */
export const THEME_FILE_TREE_ALLOWED_EXTENSIONS: readonly string[] = [
  "html", "htm", "css", "js", "mjs", "map", "json", "svg", "png", "jpg", "jpeg", "gif", "webp",
  "avif", "ico", "woff", "woff2", "ttf", "otf", "txt", "md", "xml", "webmanifest", "liquid",
];

export const FILE_TREE_KINDS: Readonly<Record<FileTreeKind, FileTreeKindSpec>> = {
  "theme-files": { baseDir: "themes", idSegmentCount: 2, allowedExtensions: THEME_FILE_TREE_ALLOWED_EXTENSIONS },
  "agent-skill": { baseDir: "skills", idSegmentCount: 2, allowedExtensions: null },
  "agent-plugin": { baseDir: "agent-plugins", idSegmentCount: 2, allowedExtensions: null },
  "site-plugin": { baseDir: "plugins", idSegmentCount: 2, allowedExtensions: null },
};

/** §2: every id segment (a tier name, a theme id, a workspace id, a package digest, ...) must match
 *  this shape — lowercase alphanumerics, optionally hyphen/dot-joined, no leading/trailing separator,
 *  no empty segment. */
const ID_SEGMENT_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const MAX_ID_SEGMENT_LENGTH = 64;

/**
 * Validates and joins one file tree's own address segments (e.g. `["static", "basic"]` for a theme)
 * into the POSIX-relative root a real contributor resolves against its own themes/skills/plugins
 * root. Returns `null` when any segment fails {@link ID_SEGMENT_PATTERN}/length, the segment count
 * does not match `kind`'s `idSegmentCount`, or a segment is empty.
 *
 * Every kind's result is prefixed with its own fixed, non-configurable `baseDir` — this is the
 * property the static boundary test (§2 item b) checks: no combination of (kind, valid id segments)
 * can ever produce a bare site-root filename, because a site-root file's own name never contains `/`
 * and every result here does.
 *
 * @complexity O(s) in the segment count (fixed, small).
 */
export function resolveTreeRelativePath({ kind, idSegments }: { kind: FileTreeKind; idSegments: readonly string[] }, _optional = {}): string | null {
  const spec = FILE_TREE_KINDS[kind];
  if (idSegments.length !== spec.idSegmentCount) return null;
  for (const segment of idSegments) {
    if (segment.length === 0 || segment.length > MAX_ID_SEGMENT_LENGTH || !ID_SEGMENT_PATTERN.test(segment)) {
      return null;
    }
  }
  return [spec.baseDir, ...idSegments].join("/");
}

/** §2 deny-list — path SEGMENTS (never just the leaf name) that block a tree at any depth: a nested
 *  `.git` checkout, a vendored `node_modules`, or this feature's own staging/backup directories
 *  (never legitimately part of a source tree — {@link normalizeMode}'s caller stages under exactly
 *  these names, so a tree that already contains one is either corrupt or hostile). */
const DENY_SEGMENTS: ReadonlySet<string> = new Set([".git", "node_modules", ".publish-staging", ".publish-previous"]);

/** §2 deny-list — file EXTENSIONS (case-insensitive) that block a tree at any depth: private key
 *  material and raw database files, neither of which belongs in a published content/code tree. */
const DENY_EXTENSIONS: ReadonlySet<string> = new Set(["pem", "key", "p12", "pfx", "db", "sqlite", "db-wal", "db-shm"]);

/** Matches `.mcp.<anything>.json` — an MCP server config file, which can carry secrets in its own
 *  right (§2's separate "Structural secret rule" governs the one shape of that file this module still
 *  allows through: an `agent-plugin`'s own `mcp.json`/`.mcp.json`, checked by
 *  {@link checkMcpJsonSecretPlaceholders} instead of being denied outright). */
const MCP_CONFIG_NAME_PATTERN = /^\.mcp\..*\.json$/;

/**
 * OS-generated junk names (macOS Finder, Windows Explorer, AppleDouble sidecar files) that a real
 * contributor never means to publish and that reappear on disk on their own (macOS recreates
 * `.DS_Store` the moment a folder is opened in Finder again). These are IGNORED, not denied: a
 * caller walking a tree ({@link ../../theme/publish-content.ts}'s `walkThemeTree`) excludes them
 * before a file ever becomes a candidate at all. {@link checkTreeFiles} REFUSES one that still
 * reaches it (a sender whose walker did not skip it): the destination writes every file it is sent,
 * so a filtered-out name would be written without any check. Never blocking a tree the WALKER
 * found one of these in is the point of this set existing separately from
 * {@link deniedFileNameReason} — see `publish-files-plan-2026-09-24.md`'s real-world case: a theme's
 * `.DS_Store`, recreated by Finder, silently refused a legitimate publish with no reason shown.
 *
 * @complexity O(1).
 */
export function isIgnoredTreeFileName({ name }: { name: string }, _optional = {}): boolean {
  if (name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini") return true;
  if (name === ".Spotlight-V100" || name === ".Trashes") return true;
  if (name.startsWith("._")) return true; // AppleDouble sidecar, e.g. "._photo.png".
  return false;
}

/**
 * Whether `name` (a bare file name, not a path) is denied at ANY depth within a tree, and why.
 * `.env`/`.env.*` (any suffix), `.npmrc`/`.netrc` (package manager credentials), `.mcp.*.json`
 * (MCP server env — never THIS shape; an agent-plugin's own `mcp.json`/`.mcp.json` is a different,
 * unprefixed name and is checked by {@link checkMcpJsonSecretPlaceholders} instead),
 * `.fs-custom-root.json` (a local absolute path), `.storage-secret.json` (a Postgres site's sealed
 * connection string, `storage-secret.ts`), and any `id_rsa`/`id_ed25519` private key file
 * (with or without an extension, e.g. `id_rsa.bak`). macOS's `.DS_Store` and its siblings are NOT
 * here — see {@link isIgnoredTreeFileName}: they are silently excluded, never a whole-tree DENY.
 *
 * @complexity O(1).
 */
function deniedFileNameReason({ name }: { name: string }, _optional = {}): string | null {
  // Judged on the name a backup/editor copy still means (`.npmrc.bak`, `.env~`, any case).
  const base = credentialBaseName({ name });
  if (base === ".env" || base.startsWith(".env.")) return "looks like an environment file";
  if (base === ".npmrc" || base === ".netrc") return "is a package-manager credential file";
  if (MCP_CONFIG_NAME_PATTERN.test(base)) return "is an MCP server configuration file, which can hold secrets";
  if (base === ".fs-custom-root.json") return "holds a local filesystem path, never portable across machines";
  if (base.includes(".storage-secret.json")) return "is a site's sealed database connection string";
  if (["id_rsa", "id_ed25519"].some((prefix) => base === prefix || base.startsWith(`${prefix}.`))) {
    return "looks like a private SSH key";
  }
  return null;
}

/** Editor/backup suffixes that leave a credential file's meaning intact, stacked or alone. */
const BACKUP_SUFFIX_PATTERN = /(?:\.(?:bak|old|orig)|~)+$/;

/** The lowercased name with trailing backup suffixes removed: `.NPMRC.bak~` → `.npmrc`. Shared with
 *  the raw-file backstop so both policies recognise the same credential copies. @complexity O(k). */
export function credentialBaseName({ name }: { name: string }, _optional: Record<string, never> = {}): string {
  return name.toLowerCase().replace(BACKUP_SUFFIX_PATTERN, "");
}

/** Key and database files by name, including a stemless `.pem`/`.key` and backups such as
 *  `site.db.bak` or `content.sqlite3`, which the extension rule alone does not see. @complexity O(k). */
function deniedKeyOrDatabaseReason({ base }: { base: string }, _optional: Record<string, never> = {}): string | null {
  if (/\.(?:pem|key|p12|pfx)$/.test(base)) return "looks like a private key or certificate file";
  if (/\.(?:db|sqlite3?)$/.test(base)) return "looks like a database file";
  return null;
}

/** §2: `.site-meta.json` and `config.json` are denied only AT THE TREE ROOT (depth 0) — both are a
 *  site's own per-install identity/host config, never a real theme/skill/plugin file, but the name
 *  alone is not suspicious at depth inside a tree (a theme could legitimately have its own nested
 *  `config.json` fixture). `${path}` here is already known to contain no `/` when this is checked. */
const ROOT_ONLY_DENIED_NAMES: ReadonlySet<string> = new Set([".site-meta.json", "config.json"]);

/** §3 caps: tree ≤ 64 MiB and ≤2000 files. The per-file cap (the host's document byte ceiling) is
 *  REQUIRED on {@link checkTreeFiles} (`maxFileBytes`) rather than imported, so this domain never
 *  reaches the media implementation. Exported so a caller (or a test) can reference the exact numbers
 *  rather than re-deriving them. */
export const FILE_TREE_LIMITS = {
  maxTreeBytes: 64 * 1024 * 1024,
  maxTreeFiles: 2000,
} as const;

/** Above this size, a text-like file is not content-scanned (§2's content-scan clause: "every file
 *  ≤1 MB whose extension is text-like"). A binary this large legitimately exceeds any real theme
 *  source file; scanning it would cost real CPU for a file type this check does not target.
 *  Exported so a `pack()` (`features/theme/publish-content.ts`) can decide, once, whether a file is
 *  even worth decoding into a `textSample` before handing it to {@link checkTreeFiles} — that
 *  decision must use the SAME threshold this module scans against, or a file just over the line would
 *  be decoded for nothing (never scanned) while one just under it would be silently skipped by a
 *  caller using a different number. */
export const MAX_SECRET_SCAN_BYTES = 1024 * 1024;

/** Extensions whose content is worth running the injected {@link TextSecretScanner} against — a strict subset of
 *  {@link THEME_FILE_TREE_ALLOWED_EXTENSIONS} (binary formats like `png`/`woff2` are never text). */
const TEXT_LIKE_SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  "html", "htm", "css", "js", "mjs", "map", "json", "svg", "txt", "md", "xml", "webmanifest", "liquid",
]);

/** @complexity O(1). */
function extensionOf({ relPath }: { relPath: string }, _optional = {}): string {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** @complexity O(1). */
function baseNameOf({ relPath }: { relPath: string }, _optional = {}): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

/** Common video container extensions — the one file type an operator is most likely to accidentally
 *  drop into a theme folder (a recorded demo, a hero clip meant for a CDN instead), which is why the
 *  terse reason names it specifically rather than folding it into the generic "file type" wording. */
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv"]);

/** The sentinel prefix that marks a `checkTreeFiles` reason as already operator-facing and final —
 *  see this file's header and {@link wrapTreePolicyReason}. Never itself compared against outside this
 *  module; a caller calls {@link wrapTreePolicyReason} instead of checking for this directly. */
const PREFORMATTED_REASON_PREFIX = "Can't publish:";

/**
 * The disallowed-extension reason, terse and operator-facing (this file's header exception) — no
 * title, no path, no raw extension string, just what the operator would ask when told a publish
 * failed: what kind of file, and which one.
 *
 * @complexity O(1).
 */
function disallowedExtensionReason({ path }: { path: string }, _optional = {}): string {
  const name = baseNameOf({ relPath: path });
  const ext = extensionOf({ relPath: path });
  return VIDEO_EXTENSIONS.has(ext)
    ? `${PREFORMATTED_REASON_PREFIX} contains a video file (${name})`
    : `${PREFORMATTED_REASON_PREFIX} contains a file type that isn't allowed (${name})`;
}

/**
 * Wraps a `checkTreeFiles` reason with `title` for display, UNLESS the reason is already final
 * (currently only {@link disallowedExtensionReason}'s output) — the one seam a caller uses instead of
 * concatenating `"${title} was not published: ${reason}"` itself, so the sentinel that marks a
 * preformatted reason lives in exactly one place.
 *
 * @complexity O(1).
 */
export function wrapTreePolicyReason({ title, reason }: { title: string; reason: string }, _optional = {}): string {
  return reason.startsWith(PREFORMATTED_REASON_PREFIX) ? reason : `${title} was not published: ${reason}`;
}

/**
 * §3's "path shape (source AND destination)" rule for ONE relative path, plus §2's deny-list. Applied
 * identically on the packing side and the destination's `precheck` re-check (this file's own header),
 * so a path either side would refuse is refused by both.
 *
 * @returns A human-readable reason `relPath` is not publishable, or `null` when it is clean of every
 *   shape/deny-list rule this function checks — {@link checkTreeFiles} additionally applies the
 *   per-kind extension allow-list, caps, and content scan, none of which a single path can answer on
 *   its own.
 * @complexity O(k) in `relPath`'s length (segment split, one deny-list lookup per segment).
 */
export function checkTreePath({ relPath }: { relPath: string }, _optional = {}): string | null {
  const shapeReason = treePathShapeReason({ relPath });
  if (shapeReason) return shapeReason;
  const segments = relPath.split("/");
  const segmentReason = treePathSegmentReason({ relPath, segments });
  if (segmentReason) return segmentReason;

  const name = segments[segments.length - 1] as string;
  const deniedReason = deniedFileNameReason({ name });
  if (deniedReason) return `"${relPath}" ${deniedReason}`;
  if (segments.length === 1 && ROOT_ONLY_DENIED_NAMES.has(name)) {
    return `"${relPath}" is a per-install site file, never part of a published tree`;
  }

  const ext = extensionOf({ relPath });
  if (DENY_EXTENSIONS.has(ext)) return `"${relPath}" has a '.${ext}' extension, which is never published`;
  const keyOrDatabase = deniedKeyOrDatabaseReason({ base: credentialBaseName({ name }) });
  if (keyOrDatabase) return `"${relPath}" ${keyOrDatabase}`;

  return null;
}

/** Checks raw path shape before interpreting segments. @complexity O(k) in path length. */
function treePathShapeReason({ relPath }: { relPath: string }, _options = {}): string | null {
  if (relPath.length === 0) return `"${relPath}" is empty`;
  if (relPath.length > 512) return `"${relPath}" is longer than the 512-character path limit`;
  if (relPath.startsWith("/")) return `"${relPath}" must be relative, not start with '/'`;
  if (relPath.includes("\\")) return `"${relPath}" contains a backslash, which is never allowed in a tree path`;
  // Deliberately reject a literal NUL byte.
  if (relPath.includes("\0")) return `"${relPath}" contains a NUL byte`;

  return null;
}

/** Checks depth and every directory component. @complexity O(k) in path length. */
function treePathSegmentReason({ relPath, segments }: { relPath: string; segments: string[] }, _options = {}): string | null {
  if (segments.length > 16) return `"${relPath}" is nested deeper than the 16-level limit`;

  for (const segment of segments) {
    if (segment.length === 0) return `"${relPath}" contains an empty path segment`;
    if (segment === "." || segment === "..") return `"${relPath}" contains a '${segment}' segment, which is never allowed`;
    if (DENY_SEGMENTS.has(segment)) return `"${relPath}" contains a '${segment}' segment, which is never published`;
  }

  return null;
}

/**
 * §2's structural secret rule for an agent-plugin's own `mcp.json`/`.mcp.json`: every `env`/`headers`
 * value must be empty or a `${VAR}` placeholder — never a literal token. Exported for `agent-plugin`'s
 * own contributor (S-F5) to call directly on a candidate file's text; not invoked by
 * {@link checkTreeFiles} itself, since only `agent-plugin` trees ever carry this file shape and
 * {@link checkTreeFiles} has no per-file "this one is mcp.json" signal to key off of without adding a
 * caller contract every other kind would have to satisfy for nothing.
 *
 * @returns A reason naming the first offending key, or `null` when every `env`/`headers` value (at
 *   any nesting, including each server's own sections) is empty or a `${...}` placeholder, or when the JSON
 *   does not parse (a malformed `mcp.json` is a different tree's own problem, not this check's).
 * @complexity O(n) in the JSON text length.
 */
export function checkMcpJsonSecretPlaceholders({ jsonText }: { jsonText: string }, _optional = {}): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  return mcpConfigReason({ value: parsed, path: "" });
}

/** Find env/header sections in server declarations as well as the legacy root shape.
 * @complexity O(n) JSON nodes; traversal uses O(depth) stack space. */
function mcpConfigReason({ value, path }: { value: unknown; path: string }, _options = {}): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["env", "headers"] as const) {
    const section = path ? `${path}.${key}` : key;
    const reason = mcpSectionReason({ section, value: record[key] });
    if (reason) return reason;
  }
  return mcpNestedConfigReason({ record, path });
}

/** Search child declarations only after this node's env/headers have passed.
 * @complexity O(n) JSON nodes; traversal uses O(depth) stack space. */
function mcpNestedConfigReason(
  { record, path }: { record: Record<string, unknown>; path: string },
  _options: Record<string, never> = {}
): string | null {
  for (const [key, entry] of Object.entries(record)) {
    if (key === "env" || key === "headers") continue;
    const reason = mcpConfigReason({ value: entry, path: path ? `${path}.${key}` : key });
    if (reason) return reason;
  }
  return null;
}

/** Check every string leaf in an MCP section, including nested objects and arrays.
 * @complexity O(n) section nodes; O(depth) stack space. */
function mcpSectionReason({ section, value }: { section: string; value: unknown }, _options = {}): string | null {
  if (typeof value === "string") {
    return value.length === 0 || /^\$\{[^}]+\}$/.test(value) ? null
      : `has a key written into mcp.json (${section}); move it to live's settings`;
  }
  if (typeof value !== "object" || value === null) return null;
  for (const [key, entry] of Object.entries(value)) {
    const reason = mcpSectionReason({ section: `${section}.${key}`, value: entry });
    if (reason) return reason;
  }
  return null;
}

/** Mode bits {@link normalizeMode} strips down to — the exec bit is the only thing a published tree's
 *  mode is ever allowed to carry beyond ordinary read/write; setuid/setgid/sticky and group/other
 *  write bits are never meaningful for a published static/content tree and are a real privilege-
 *  escalation surface if they ever reached disk unmodified. */
const NORMALIZED_FILE_MODE = 0o644;
const NORMALIZED_EXEC_MODE = 0o755;

/**
 * §3's mode normalization: any raw `mode` with any of the owner/group/other EXECUTE bits set becomes
 * `0o755`; every other mode (including one with setuid/setgid/sticky/write-only-by-others bits, which
 * this collapses away entirely) becomes the plain `0o644`. Applied identically to every packed file
 * before it is ever staged, so a hostile or accidental setuid bit never survives a publish.
 *
 * @complexity O(1).
 */
export function normalizeMode({ mode }: { mode: number }, _optional = {}): number {
  return (mode & 0o111) !== 0 ? NORMALIZED_EXEC_MODE : NORMALIZED_FILE_MODE;
}

/** One file {@link checkTreeFiles} evaluates. `textSample` is the file's own text content (or a
 *  size-capped prefix of it) — required for a real block-or-pass answer on a text-like, ≤1 MiB file;
 *  see {@link checkTreeFiles}'s own doc for what an absent sample means. */
export interface FileTreeFileInput {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
  readonly textSample?: string;
}

/**
 * The whole-tree gate: every file-shape/deny-list/extension/cap/secret-scan rule in §2/§3, over one
 * tree's full file list. The allow-list is applied first (kind-specific extensions), then the
 * deny-list (via {@link checkTreePath}, kind-agnostic), then the content scan — matching §2's own
 * stated order. A tree fails as a WHOLE the instant any file fails any rule (this file's header).
 *
 * `textSample` contract: a file with a text-like extension ({@link TEXT_LIKE_SCAN_EXTENSIONS})
 * at or under {@link MAX_SECRET_SCAN_BYTES} must carry its text for scanning. A missing sample
 * blocks the tree: hash verification alone cannot establish that the bytes are free of secrets.
 * The source walker and destination byte reader must both supply the qualifying file's sample.
 *
 * `scanTextForSecrets` is REQUIRED (injected by the host) so this module never depends on a scanner
 * implementation.
 *
 * @returns One human-readable reason (naming the offending path) for the whole tree, or `null` when
 *   every file passes every check.
 * @complexity O(f + b) — one pass over the `f` files for shape/deny/extension/cap checks, plus one
 *   secret scan (§(p) pattern count times sample length) per qualifying file; `b` is the sum of every
 *   scanned file's `textSample` length.
 */
export function checkTreeFiles({ kind, files, scanTextForSecrets, maxFileBytes }: { kind: FileTreeKind; files: readonly FileTreeFileInput[]; scanTextForSecrets: TextSecretScanner; maxFileBytes: number }, _optional = {}): string | null {
  const limits = FILE_TREE_LIMITS;
  if (files.length > limits.maxTreeFiles) {
    return `this tree has ${files.length} files, more than the ${limits.maxTreeFiles}-file limit`;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > limits.maxTreeBytes) {
    return `this tree is ${totalBytes} bytes, larger than the ${limits.maxTreeBytes}-byte limit`;
  }

  const seenLowercase = new Map<string, string>();
  const spec = FILE_TREE_KINDS[kind];

  for (const file of files) {
    const reason = treeFileReason({ file, spec, seenLowercase, scanTextForSecrets, maxFileBytes });
    if (reason) return reason;
  }

  return null;
}

/** Checks one file in original refusal order, recording case collisions. @complexity O(k) in path length. */
function treeFileReason({ file, spec, seenLowercase, scanTextForSecrets, maxFileBytes }: {
  file: FileTreeFileInput; spec: FileTreeKindSpec; seenLowercase: Map<string, string>; scanTextForSecrets: TextSecretScanner; maxFileBytes: number;
}, _options = {}): string | null {
  const shapeReason = checkTreePath({ relPath: file.path });
  if (shapeReason) return shapeReason;
  // A walker skips OS junk before this runs (`isIgnoredTreeFileName`), so one reaching here came
  // from a sender that did not — on the destination, every listed file is written. Refused, never
  // filtered: filtering would let it skip every check below and still be staged.
  if (isIgnoredTreeFileName({ name: file.path.slice(file.path.lastIndexOf("/") + 1) })) {
    return `"${file.path}" is a system file that is never published`;
  }

  const lower = file.path.toLowerCase();
  const earlier = seenLowercase.get(lower);
  if (earlier !== undefined) {
    return `"${earlier}" and "${file.path}" differ only by letter case, which is not safe to publish`;
  }
  seenLowercase.set(lower, file.path);

  if (file.size > maxFileBytes) {
    return `"${file.path}" is ${file.size} bytes, larger than the ${maxFileBytes}-byte per-file limit`;
  }

  return treeFileContentReason({ file, spec, scanTextForSecrets });
}

/** Applies the kind's allowlist, refusing missing scan input before checking text.
 * @complexity O(b) in sample length. */
function treeFileContentReason({ file, spec, scanTextForSecrets }: { file: FileTreeFileInput; spec: FileTreeKindSpec; scanTextForSecrets: TextSecretScanner }, _options = {}): string | null {
  // Bundled vendor attribution must travel with the theme. Treat canonical extensionless notices
  // as text so they get the same mandatory secret scan, never a blanket extensionless exemption.
  const ext = /^(?:LICENSE|COPYING|NOTICE)$/i.test(baseNameOf({ relPath: file.path })) ? "txt" : extensionOf({ relPath: file.path });
  if (spec.allowedExtensions && !spec.allowedExtensions.includes(ext)) {
    return disallowedExtensionReason({ path: file.path });
  }

  if (TEXT_LIKE_SCAN_EXTENSIONS.has(ext) && file.size <= MAX_SECRET_SCAN_BYTES) {
    return treeFileSecretReason({ file, scanTextForSecrets });
  }
  return null;
}

/** Runs the injected scanner over one file's sample, refusing a missing sample. @complexity O(b) in sample length. */
function treeFileSecretReason({ file, scanTextForSecrets }: { file: FileTreeFileInput; scanTextForSecrets: TextSecretScanner }, _options = {}): string | null {
  if (file.textSample === undefined) return `"${file.path}" is missing the text required for its secret scan`;
  const hits = scanTextForSecrets({ text: file.textSample });
  if (hits.length > 0) {
    const hit = hits[0];
    if (hit === undefined) throw new Error("Secret scan reported a hit without details");
    return `"${file.path}" looks like it holds a key (${hit.patternName})`;
  }
  return null;
}

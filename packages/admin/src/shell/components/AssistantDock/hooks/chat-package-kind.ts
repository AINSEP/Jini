import { orFallback } from "@jini-ai/core/errors/idioms";

type ChatPackageKind = "skill" | "site-plugin" | "agent-plugin" | "attachment";
type CentralDirectory = { count: number; offset: number; size: number };
/** Manifest file names the host still honours as site-plugin aliases (its legacy names); matched exactly, like `jini.plugin.json`. */
type LegacyManifestNames = readonly string[];

const END_RECORD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
/** End record plus the largest possible ZIP comment. */
const END_RECORD_SEARCH_BYTES = 65557;
const MAX_ENTRIES = 4096;
const MAX_DIRECTORY_BYTES = 1024 * 1024;
const PACKAGE_MARKER = /^(?:[^/]+\/)?(?:SKILL\.md|jini\.plugin\.json|plugin\.json)$/;

/** A marker at the archive root or one folder deep: the fixed names, or one of the host's legacy manifest aliases. */
function isPackageMarker({ name, legacyManifestNames }: { name: string; legacyManifestNames: LegacyManifestNames }): boolean {
  if (PACKAGE_MARKER.test(name)) return true;
  const slash = name.indexOf("/");
  const base = slash > 0 ? name.slice(slash + 1) : name;
  return slash !== 0 && !base.includes("/") && legacyManifestNames.includes(base);
}

/** Scans backwards for the end record whose comment length reaches exactly the end of the file; -1 when none does. */
function findEndRecord({ tail }: { tail: Uint8Array }): number {
  const view = new DataView(tail.buffer);
  for (let eocd = tail.length - END_RECORD_SIZE; eocd >= 0; eocd--) {
    if (view.getUint32(eocd, true) === END_RECORD_SIGNATURE && eocd + END_RECORD_SIZE + view.getUint16(eocd + 20, true) === tail.length) return eocd;
  }
  return -1;
}

/** Locates a single-disk, bounded, self-consistent central directory; null keeps the file an attachment. */
function readCentralDirectory({ tail, tailStart }: { tail: Uint8Array; tailStart: number }): CentralDirectory | null {
  const eocd = findEndRecord({ tail });
  if (eocd < 0) return null;
  const end = new DataView(tail.buffer);
  if (end.getUint16(eocd + 4, true) !== 0 || end.getUint16(eocd + 6, true) !== 0) return null;
  const count = end.getUint16(eocd + 10, true);
  const size = end.getUint32(eocd + 12, true), offset = end.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES || count !== end.getUint16(eocd + 8, true) || size > MAX_DIRECTORY_BYTES || offset + size !== tailStart + eocd) return null;
  return { count, offset, size };
}

/** Reads one central header's normalized name and the next header's offset; null when the header is malformed. */
function readEntry({ bytes, view, cursor }: { bytes: Uint8Array; view: DataView; cursor: number }): { name: string; next: number } | null {
  if (cursor + CENTRAL_HEADER_SIZE > bytes.length || view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) return null;
  const length = view.getUint16(cursor + 28, true);
  const next = cursor + CENTRAL_HEADER_SIZE + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  if (next > bytes.length) return null;
  const name = new TextDecoder().decode(bytes.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + length)).replaceAll("\\", "/").replace(/^\.\//, "");
  return { name, next };
}

/** Collects package marker filenames at the archive root or one folder deep; null when the directory is not exactly `count` headers. */
function readPackageMarkers({ bytes, count, legacyManifestNames }: { bytes: Uint8Array; count: number; legacyManifestNames: LegacyManifestNames }): Set<string> | null {
  const view = new DataView(bytes.buffer), names = new Set<string>();
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const entry = readEntry({ bytes, view, cursor });
    if (!entry) return null;
    if (isPackageMarker({ name: entry.name, legacyManifestNames }) && !entry.name.startsWith("__MACOSX/")) names.add(entry.name.slice(entry.name.lastIndexOf("/") + 1));
    cursor = entry.next;
  }
  return cursor === bytes.length ? names : null;
}

function kindFromMarkers({ names, legacyManifestNames }: { names: Set<string>; legacyManifestNames: LegacyManifestNames }): ChatPackageKind {
  // A plugin may bundle skills. Its manifest takes precedence so it can reach the assistant.
  if (names.has("jini.plugin.json") || legacyManifestNames.some(name => names.has(name))) return "site-plugin"; // the host's legacy manifest aliases
  if (names.has("plugin.json")) return "agent-plugin";
  return names.has("SKILL.md") ? "skill" : "attachment";
}

async function zipPackageKind({ file, legacyManifestNames }: { file: File; legacyManifestNames: LegacyManifestNames }): Promise<ChatPackageKind> {
  const tailStart = Math.max(0, file.size - END_RECORD_SEARCH_BYTES);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const directory = readCentralDirectory({ tail, tailStart });
  if (!directory) return "attachment";
  const bytes = new Uint8Array(await file.slice(directory.offset, directory.offset + directory.size).arrayBuffer());
  const names = readPackageMarkers({ bytes, count: directory.count, legacyManifestNames });
  return names ? kindFromMarkers({ names, legacyManifestNames }) : "attachment";
}

/** ZIP names are a routing hint, never install validation. Read only the bounded central directory:
 * deflated payloads need no decompression, and malformed/ZIP64 archives remain ordinary attachments.
 * The ZIP name inspection lives here, beside the routing it serves, rather than in a separate archive helper.
 */
export async function chatPackageKind(
  { file, legacyManifestNames }: { file: File; legacyManifestNames: LegacyManifestNames },
  _optional: Record<string, never> = {},
): Promise<ChatPackageKind> {
  if (file.name === "SKILL.md") return "skill";
  if (!file.name.toLowerCase().endsWith(".zip")) return "attachment";
  return orFallback({ work: () => zipPackageKind({ file, legacyManifestNames }), fallback: "attachment", step: "Identify chat archive" });
}

/** Jini annotates expanded browser folders with relativePath. Keep a skill's companion files
 * together, but let a plugin manifest at that folder root override all its bundled SKILL.md files. */
export async function partitionChatPackages(
  { files, legacyManifestNames }: { files: readonly File[]; legacyManifestNames: LegacyManifestNames },
  _optional: Record<string, never> = {},
): Promise<{ skills: File[]; attachments: File[] }> {
  const paths = files.map(file => ((file as File & { relativePath?: string }).relativePath || file.webkitRelativePath || "").replaceAll("\\", "/"));
  const roots = paths.map(value => value.includes("/") ? value.slice(0, value.indexOf("/") + 1) : "");
  const pluginRoots = new Set(roots.filter((root, index) => root && (paths[index] === `${root}plugin.json` || paths[index] === `${root}jini.plugin.json` || legacyManifestNames.some(name => paths[index] === `${root}${name}`)))); // the host's legacy manifest aliases
  const skillRoots = new Set(roots.filter((root, index) => root && files[index]?.name === "SKILL.md" && !pluginRoots.has(root)));
  const kinds = await Promise.all(files.map(file => chatPackageKind({ file, legacyManifestNames })));
  const skills: File[] = [], attachments: File[] = [];
  files.forEach((file, index) => {
    const root = roots[index] ?? ""; // roots is index-aligned with files; "" is the same no-folder value
    const insidePlugin = Boolean(root) && pluginRoots.has(root);
    const insideSkill = Boolean(root) && skillRoots.has(root);
    const isSkill = !insidePlugin && (insideSkill || kinds[index] === "skill");
    (isSkill ? skills : attachments).push(file);
  });
  return { skills, attachments };
}

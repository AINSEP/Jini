/**
 * @module artifacts/node/stub-guard
 *
 * The real, disk-backed half of `../stub-guard.js`'s stub-regression guard: scans a directory for
 * prior siblings sharing an identifier with a newly-written artifact, then hands the result to the
 * universal `classifyArtifactStubGuard` for the actual pass/warn/reject decision. Lives at the
 * separate `@jini-ai/artifacts/node` entry point (not the package's main `.` barrel) because this
 * is the only part of the stub guard that touches `node:fs`/`node:path` — importing it explicitly,
 * rather than having it ride along with every `@jini-ai/artifacts` import, is what lets the main
 * entry point stay genuinely runtime-universal.
 */
import { constants, type Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactIdentifiersMatch,
  classifyArtifactStubGuard,
  slugifyArtifactIdentifier,
  EMPTY_SLUG_FALLBACK_NAME,
  type ArtifactStubGuardConfig,
  type EvaluateArtifactStubGuardResult,
  type PriorArtifactSibling,
} from '../stub-guard.js';

/** Injectable filesystem for sibling scans. */
export interface ArtifactStubFilesystemPort {
  readFile(required: { path: string; maxBytes: number }): Promise<string>;
  readdir(required: { path: string }): Promise<Dirent[]>;
  stat(required: { path: string }): Promise<{ size: number }>;
}
/** The subset of `node:fs/promises`' `FileHandle` the bounded sidecar reader uses. */
export interface ArtifactSidecarFileHandle {
  stat(): Promise<{ isFile(): boolean; size: number }>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
/** Opens one sidecar for reading with the given `node:fs` open flags. */
export type ArtifactSidecarOpenPort = (required: { path: string; flags: number }) => Promise<ArtifactSidecarFileHandle>;

const MAX_SIDECAR_BYTES = 64 * 1024;

/** Reads at most maxBytes+1 from one regular, nonlink sidecar; oversized input is refused.
 * Closes its descriptor on every exit. O(maxBytes) space/time. */
async function readBoundedSidecar({ path, maxBytes, openFile }: { path: string; maxBytes: number; openFile: ArtifactSidecarOpenPort }, _options = {}): Promise<string> {
  const file = await openFile({ path, flags: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK });
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid artifact sidecar');
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    // `stat` above is only a fast pre-check: a sidecar can grow between it and the reads, so the
    // bytes actually read are what enforce the limit.
    if (length > maxBytes) throw new Error('Artifact sidecar exceeds the byte limit');
    return bytes.toString('utf8', 0, length);
  } finally { await file.close(); }
}

/** The disk-backed filesystem port; `openFile` defaults to `node:fs/promises`' `open`. */
export function createNodeArtifactStubFilesystem(
  _required: Record<string, never> = {},
  { openFile = ({ path: filePath, flags }) => open(filePath, flags) }: { openFile?: ArtifactSidecarOpenPort } = {},
): ArtifactStubFilesystemPort {
  return {
    readFile: ({ path: filePath, maxBytes }) => readBoundedSidecar({ path: filePath, maxBytes, openFile }),
    readdir: ({ path: dirPath }) => readdir(dirPath, { withFileTypes: true }),
    stat: ({ path: filePath }) => stat(filePath),
  };
}
const nativeFilesystem: ArtifactStubFilesystemPort = createNodeArtifactStubFilesystem();

export interface EvaluateArtifactStubGuardInput {
  readonly scanDir: string;
  readonly identifier: string;
  readonly newSize: number;
  readonly config: ArtifactStubGuardConfig;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readSidecarIdentifier(scanDir: string, entryName: string, filesystem: ArtifactStubFilesystemPort): Promise<string | null> {
  try {
    const raw = await filesystem.readFile({ path: path.join(scanDir, `${entryName}.artifact.json`), maxBytes: MAX_SIDECAR_BYTES });
    if (Buffer.byteLength(raw, 'utf8') > MAX_SIDECAR_BYTES) return null;
    const parsed = JSON.parse(raw) as { metadata?: { identifier?: unknown } } | null;
    const id = parsed?.metadata?.identifier;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function legacyCandidateIdentifiers(filename: string, extensionPattern: RegExp, suffixPattern: RegExp): string[] {
  const fullBasename = filename.replace(extensionPattern, '');
  const stripped = filename.replace(suffixPattern, '');
  const candidates: string[] = [];
  if (fullBasename.length > 0) candidates.push(fullBasename);
  if (stripped.length > 0 && stripped !== fullBasename) candidates.push(stripped);
  return candidates;
}

function siblingPatterns(
  { identifier, extAlternation }: { identifier: string; extAlternation: string },
  _options: Record<string, never> = {},
): { pattern: RegExp; extensionPattern: RegExp; suffixPattern: RegExp } {
  const extensionPattern = new RegExp(`(?:${extAlternation})$`, 'i');
  const suffixPattern = new RegExp(`(?:-\\d+)?(?:${extAlternation})$`, 'i');

  const tokens = new Set<string>();
  tokens.add(identifier);
  const slug = slugifyArtifactIdentifier({ value: identifier });
  if (slug.length > 0) tokens.add(slug);
  else tokens.add(EMPTY_SLUG_FALLBACK_NAME);
  const alternation = Array.from(tokens, escapeRegExp).join('|');
  const pattern = new RegExp(`^(?:${alternation})(?:-\\d+)?(?:${extAlternation})$`, 'i');
  return { pattern, extensionPattern, suffixPattern };
}

async function readMatchingSibling(
  { scanDir, identifier, entry, extensionPattern, suffixPattern }: {
    scanDir: string;
    identifier: string;
    entry: Dirent;
    extensionPattern: RegExp;
    suffixPattern: RegExp;
  },
  { filesystem = nativeFilesystem }: { filesystem?: ArtifactStubFilesystemPort } = {},
): Promise<PriorArtifactSibling | null> {
  const sidecarIdentifier = await readSidecarIdentifier(scanDir, entry.name, filesystem);
  // `legacyCandidateIdentifiers` always returns at least one non-empty
  // candidate here: the caller already matched `entry.name` against `pattern`, which
  // requires its basename to start with one of `tokens` (all non-empty),
  // so an explicit `candidateIdentifiers.length === 0` guard would be
  // dead code — an empty array's `.some()` below already rejects the candidate.
  const candidateIdentifiers = sidecarIdentifier !== null
    ? [sidecarIdentifier]
    : legacyCandidateIdentifiers(entry.name, extensionPattern, suffixPattern);
  if (!candidateIdentifiers.some((c) => artifactIdentifiersMatch({ a: identifier, b: c }))) return null;
  try {
    const st = await filesystem.stat({ path: path.join(scanDir, entry.name) });
    return { name: entry.name, size: st.size };
  } catch {
    // Ignore unreadable entries — they don't influence the guard decision.
    return null;
  }
}

/**
 * Finds prior siblings on disk that share an identifier with a newly-written
 * artifact, matching `<identifier>(-N)?.<ext>` for any of `config.siblingExtensions`.
 * The scan deliberately includes any file at the same path as the new write
 * — when a write overwrites an existing file with the same name, the file
 * currently on disk is the prior content (the overwrite happens after this
 * scan runs).
 */
export async function findPriorArtifactSiblings(
  { scanDir, identifier, config }: { scanDir: string; identifier: string; config: Pick<ArtifactStubGuardConfig, 'siblingExtensions'> },
  { filesystem = nativeFilesystem }: { filesystem?: ArtifactStubFilesystemPort } = {},
): Promise<PriorArtifactSibling[]> {
  if (identifier.length === 0) return [];
  const extAlternation = config.siblingExtensions.map(escapeRegExp).join('|');
  if (!extAlternation) return [];
  const { pattern, extensionPattern, suffixPattern } = siblingPatterns({ identifier, extAlternation });

  let entries: Dirent[];
  try {
    entries = await filesystem.readdir({ path: scanDir });
  } catch {
    return [];
  }
  const results: PriorArtifactSibling[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!pattern.test(entry.name)) continue;
    const sibling = await readMatchingSibling(
      { scanDir, identifier, entry, extensionPattern, suffixPattern },
      { filesystem },
    );
    if (sibling) results.push(sibling);
  }
  return results;
}

export async function evaluateArtifactStubGuard(
  input: EvaluateArtifactStubGuardInput,
  optional: { filesystem?: ArtifactStubFilesystemPort } = {},
): Promise<EvaluateArtifactStubGuardResult> {
  if (input.config.mode === 'off') return { outcome: 'pass' };
  if (input.identifier.length === 0) return { outcome: 'pass' };
  const priors = await findPriorArtifactSiblings({ scanDir: input.scanDir, identifier: input.identifier, config: input.config }, optional);
  return classifyArtifactStubGuard({ priors, identifier: input.identifier, newSize: input.newSize, config: input.config });
}

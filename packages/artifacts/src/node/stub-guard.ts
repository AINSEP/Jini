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
import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
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

export interface EvaluateArtifactStubGuardInput {
  readonly scanDir: string;
  readonly identifier: string;
  readonly newSize: number;
  readonly config: ArtifactStubGuardConfig;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readSidecarIdentifier(scanDir: string, entryName: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(scanDir, `${entryName}.artifact.json`), 'utf8');
    const parsed = JSON.parse(raw) as { metadata?: { identifier?: unknown } } | null;
    const id = parsed?.metadata?.identifier;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function extensionAlternation(extensions: readonly string[]): string {
  return extensions.map((ext) => escapeRegExp(ext)).join('|');
}

function legacyCandidateIdentifiers(filename: string, extensionPattern: RegExp, suffixPattern: RegExp): string[] {
  const fullBasename = filename.replace(extensionPattern, '');
  const stripped = filename.replace(suffixPattern, '');
  const candidates: string[] = [];
  if (fullBasename.length > 0) candidates.push(fullBasename);
  if (stripped.length > 0 && stripped !== fullBasename) candidates.push(stripped);
  return candidates;
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
  scanDir: string,
  identifier: string,
  config: Pick<ArtifactStubGuardConfig, 'siblingExtensions'>,
): Promise<PriorArtifactSibling[]> {
  if (identifier.length === 0) return [];
  const extAlternation = extensionAlternation(config.siblingExtensions);
  if (!extAlternation) return [];
  const extensionPattern = new RegExp(`(?:${extAlternation})$`, 'i');
  const suffixPattern = new RegExp(`(?:-\\d+)?(?:${extAlternation})$`, 'i');

  const tokens = new Set<string>();
  tokens.add(identifier);
  const slug = slugifyArtifactIdentifier(identifier);
  if (slug.length > 0) tokens.add(slug);
  else tokens.add(EMPTY_SLUG_FALLBACK_NAME);
  const alternation = Array.from(tokens, escapeRegExp).join('|');
  const pattern = new RegExp(`^(?:${alternation})(?:-\\d+)?(?:${extAlternation})$`, 'i');

  let entries: Dirent[];
  try {
    entries = await readdir(scanDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: PriorArtifactSibling[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!pattern.test(entry.name)) continue;
    const sidecarIdentifier = await readSidecarIdentifier(scanDir, entry.name);
    // `legacyCandidateIdentifiers` always returns at least one non-empty
    // candidate here: `entry.name` already matched `pattern` above, which
    // requires its basename to start with one of `tokens` (all non-empty),
    // so an explicit `candidateIdentifiers.length === 0` guard would be
    // dead code — an empty array's `.some()` below already `continue`s.
    const candidateIdentifiers = sidecarIdentifier !== null
      ? [sidecarIdentifier]
      : legacyCandidateIdentifiers(entry.name, extensionPattern, suffixPattern);
    if (!candidateIdentifiers.some((c) => artifactIdentifiersMatch(identifier, c))) continue;
    try {
      const st = await stat(path.join(scanDir, entry.name));
      results.push({ name: entry.name, size: st.size });
    } catch {
      // Ignore unreadable entries — they don't influence the guard decision.
    }
  }
  return results;
}

export async function evaluateArtifactStubGuard(
  input: EvaluateArtifactStubGuardInput,
): Promise<EvaluateArtifactStubGuardResult> {
  if (input.config.mode === 'off') return { outcome: 'pass' };
  if (input.identifier.length === 0) return { outcome: 'pass' };
  const priors = await findPriorArtifactSiblings(input.scanDir, input.identifier, input.config);
  return classifyArtifactStubGuard(priors, input.identifier, input.newSize, input.config);
}

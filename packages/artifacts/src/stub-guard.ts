/**
 * @module artifacts/stub-guard
 * Detect a same-identifier write whose body shrinks into a placeholder relative to its largest
 * prior sibling. Compare sizes rather than phrasing so the rule applies across producers.
 * Hosts supply siblingExtensions and environment variable names; artifact taxonomy is not a
 * kernel concern. Pure decisions/types stay runtime-universal; directory scanning belongs to
 * @jini-ai/artifacts/node so these imports never force node:fs/node:path on browser consumers.
 */

export type ArtifactStubGuardMode = 'reject' | 'warn' | 'off';

export interface ArtifactStubGuardConfig {
  readonly mode: ArtifactStubGuardMode;
  readonly minRetainedRatio: number;
  readonly minPriorBytes: number;
  /** File-name extensions (including the leading dot) this guard scans for prior siblings, e.g. `['.html', '.htm']`. */
  readonly siblingExtensions: readonly string[];
}

export interface PriorArtifactSibling {
  readonly name: string;
  readonly size: number;
}

export interface ArtifactStubGuardWarning {
  readonly code: 'ARTIFACT_REGRESSION';
  readonly message: string;
  readonly identifier: string;
  readonly newSize: number;
  readonly priorSize: number;
  readonly priorName: string;
}

export interface EvaluateArtifactStubGuardResult {
  readonly outcome: 'pass' | 'warn' | 'reject';
  readonly warning?: ArtifactStubGuardWarning;
}

export class ArtifactRegressionError extends Error {
  readonly code = 'ARTIFACT_REGRESSION';
  readonly identifier: string;
  readonly newSize: number;
  readonly priorSize: number;
  readonly priorName: string;

  constructor(
    { message, details }: { message: string; details: { identifier: string; newSize: number; priorSize: number; priorName: string } },
  ) {
    super(message);
    this.name = 'ArtifactRegressionError';
    this.identifier = details.identifier;
    this.newSize = details.newSize;
    this.priorSize = details.priorSize;
    this.priorName = details.priorName;
  }
}

export const DEFAULT_ARTIFACT_STUB_GUARD_CONFIG: ArtifactStubGuardConfig = {
  mode: 'warn',
  minRetainedRatio: 0.2,
  minPriorBytes: 4096,
  siblingExtensions: ['.html', '.htm'],
};

/** Slugifies a free-form identifier into a filename-safe basename (lowercase, `[a-z0-9_-]`, max 60 chars). */
export function slugifyArtifactIdentifier({ value }: { value: string }): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Fallback basename used when a slugified identifier is empty (e.g. an all-non-ASCII identifier strips to nothing). */
export const EMPTY_SLUG_FALLBACK_NAME = 'artifact';

/**
 * Two identifiers refer to the same artifact lineage when they're literally
 * equal, or one is the canonical slug form of the other (and that slug is
 * non-empty). Slug equality alone is not enough: a slugifier that truncates
 * at a fixed length would otherwise falsely bridge two distinct identifiers
 * that only diverge past that length — requiring one side to *be* the slug
 * form of the other avoids that while still bridging e.g. "Landing Page" and
 * "landing-page".
 */
export function artifactIdentifiersMatch({ a, b }: { a: string; b: string }): boolean {
  if (a === b) return true;
  const slugA = slugifyArtifactIdentifier({ value: a });
  if (slugA.length === 0) return false;
  const slugB = slugifyArtifactIdentifier({ value: b });
  if (slugA !== slugB) return false;
  return a === slugA || b === slugB;
}

/** Reads guard configuration from explicit environment values and host-owned names, using optional defaults for unset or invalid values. */
export function readArtifactStubGuardConfigFromEnv(
  { env, names }: { env: Readonly<Record<string, string | undefined>>; names: { mode: string; minRatio: string; minPriorBytes: string } },
  { defaults = DEFAULT_ARTIFACT_STUB_GUARD_CONFIG }: { defaults?: ArtifactStubGuardConfig } = {},
): ArtifactStubGuardConfig {
  const rawMode = (env[names.mode] ?? '').toLowerCase();
  const mode: ArtifactStubGuardMode =
    rawMode === 'reject' || rawMode === 'warn' || rawMode === 'off' ? rawMode : defaults.mode;

  const ratioRaw = Number(env[names.minRatio]);
  // Accept (0, 1] so a caller can set 1 to reject any shrinkage. Values <=0 or >1 fall back to default.
  const minRetainedRatio =
    Number.isFinite(ratioRaw) && ratioRaw > 0 && ratioRaw <= 1 ? ratioRaw : defaults.minRetainedRatio;

  const minPriorBytesRaw = Number(env[names.minPriorBytes]);
  const minPriorBytes =
    Number.isInteger(minPriorBytesRaw) && minPriorBytesRaw > 0 ? minPriorBytesRaw : defaults.minPriorBytes;

  return { mode, minRetainedRatio, minPriorBytes, siblingExtensions: defaults.siblingExtensions };
}

function buildWarning(identifier: string, newSize: number, prior: PriorArtifactSibling): ArtifactStubGuardWarning {
  return {
    code: 'ARTIFACT_REGRESSION',
    message:
      `New artifact body for identifier "${identifier}" is ${newSize} bytes, ` +
      `but the largest prior sibling "${prior.name}" is ${prior.size} bytes. ` +
      'This pattern usually means the write emitted a placeholder instead of the full document. ' +
      'Set the guard mode to "warn" to record the warning without rejecting, or "off" to disable the guard entirely.',
    identifier,
    newSize,
    priorSize: prior.size,
    priorName: prior.name,
  };
}

/** Pure decision function: given the prior siblings on disk, decides whether the new body is a stub regression. Split from the disk scan so unit tests stay fast and can pre-fetch siblings. */
export function classifyArtifactStubGuard(
  { priors, identifier, newSize, config }: { priors: readonly PriorArtifactSibling[]; identifier: string; newSize: number; config: ArtifactStubGuardConfig },
): EvaluateArtifactStubGuardResult {
  if (config.mode === 'off') return { outcome: 'pass' };
  if (identifier.length === 0) return { outcome: 'pass' };
  if (priors.length === 0) return { outcome: 'pass' };

  let largestSoFar: PriorArtifactSibling | null = null;
  for (const prior of priors) {
    if (largestSoFar === null || prior.size > largestSoFar.size) largestSoFar = prior;
  }
  // Non-null assertion, not a runtime guard: `priors.length === 0` already
  // returned above, so this loop always runs at least once, and its first
  // iteration always satisfies `largestSoFar === null` — it's always
  // assigned by the time the loop finishes.
  const largest: PriorArtifactSibling = largestSoFar!;
  if (largest.size < config.minPriorBytes) return { outcome: 'pass' };

  const threshold = largest.size * config.minRetainedRatio;
  if (newSize >= threshold) return { outcome: 'pass' };

  const warning = buildWarning(identifier, newSize, largest);
  return { outcome: config.mode === 'reject' ? 'reject' : 'warn', warning };
}

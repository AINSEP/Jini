/**
 * @module artifacts/publication-guard
 *
 * A pre-publish content guard: blocks an artifact write when its body
 * contains a caller-declared "unresolved placeholder" marker, scoped to a
 * caller-declared set of guarded kinds. Ported from OD's
 * `apps/daemon/src/artifacts/publication-guard.ts`.
 *
 * De-branded: the origin hardcoded `UNRESOLVED_ARTIFACT_PLACEHOLDERS` — five
 * literal strings ("Name to confirm", "$X.XM", ...) lifted from one specific
 * bundled example template's pitch-deck fill-in-the-blank convention — and
 * `PUBLICATION_GUARDED_ARTIFACT_KINDS = {'html', 'deck'}`. Both are entirely
 * OD's own content, not a generic engine mechanism, so this module now takes
 * a caller-supplied {@link PublicationGuardConfig} (empty by default — a
 * guard that never blocks anything until a host configures it) instead of
 * baking in that one template's marker strings. The guard *mechanism*
 * (scan a guarded-kind body for any configured marker, throw before
 * publish) is what this module owns.
 */

export const ARTIFACT_PUBLICATION_BLOCKED_CODE = 'ARTIFACT_PUBLICATION_BLOCKED' as const;

export interface PublicationGuardConfig {
  /** Artifact kinds this guard scans. A kind not in this set is never blocked, whatever its content. */
  readonly guardedKinds: ReadonlySet<string>;
  /** Substrings that mark an artifact as containing an unresolved placeholder. Matching is case-sensitive. */
  readonly blockedPlaceholders: readonly string[];
}

/** A guard that blocks nothing — no guarded kinds, no placeholder markers configured. */
export const emptyPublicationGuardConfig: PublicationGuardConfig = {
  guardedKinds: new Set(),
  blockedPlaceholders: [],
};

export class ArtifactPublicationBlockedError extends Error {
  readonly code = ARTIFACT_PUBLICATION_BLOCKED_CODE;
  readonly placeholders: readonly string[];

  constructor({ placeholders }: { placeholders: readonly string[] }) {
    super(buildArtifactPublicationBlockedMessage({ placeholders }));
    this.name = 'ArtifactPublicationBlockedError';
    this.placeholders = [...placeholders];
  }
}

export function isPublicationGuardedKind({ kind, config }: { kind: unknown; config: PublicationGuardConfig }): boolean {
  return typeof kind === 'string' && config.guardedKinds.has(kind);
}

function stringifyArtifactContent(value: unknown): string {
  if (typeof value === 'string') return value;
  // Buffer is a Uint8Array too. Preserve its UTF-8 replacement semantics and leading BOM without
  // importing a Node built-in into the universal entry; decode only the supplied view's bytes.
  if (value instanceof Uint8Array) return new TextDecoder('utf-8', { ignoreBOM: true }).decode(value);
  return '';
}

/** Returns every configured placeholder marker found in `value`'s stringified content, in declaration order. */
export function findBlockedPlaceholders({ value, config }: { value: unknown; config: PublicationGuardConfig }): string[] {
  const text = stringifyArtifactContent(value);
  if (!text) return [];
  return config.blockedPlaceholders.filter((placeholder) => text.includes(placeholder));
}

export function shouldBlockPublication({ value, config }: { value: unknown; config: PublicationGuardConfig }): boolean {
  return findBlockedPlaceholders({ value, config }).length > 0;
}

export function buildArtifactPublicationBlockedMessage({ placeholders }: { placeholders: readonly string[] }): string {
  const list = placeholders.length > 0 ? placeholders.join(', ') : 'unknown placeholders';
  return `Artifact still contains unresolved placeholders: ${list}. Resolve them before publishing.`;
}

/**
 * Throws {@link ArtifactPublicationBlockedError} when `value` (for a
 * `kind` in `config.guardedKinds`) contains any of `config.blockedPlaceholders`.
 * No-ops for a kind outside `config.guardedKinds` — a guard scoped to
 * user-facing rendered documents shouldn't reject content in other kinds
 * where the same substrings could be legitimate.
 */
export function assertArtifactPublicationAllowed(
  { kind, value, config }: { kind: unknown; value: unknown; config: PublicationGuardConfig },
): void {
  if (!isPublicationGuardedKind({ kind, config })) return;
  const placeholders = findBlockedPlaceholders({ value, config });
  if (placeholders.length > 0) {
    throw new ArtifactPublicationBlockedError({ placeholders });
  }
}

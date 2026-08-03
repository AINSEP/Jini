/**
 * @file Confirmation-tone vocabulary, shared by `ConfirmDialog` and `RowMenu` so picking one does
 * not drag in the other.
 *
 * `ConfirmTone` lived in `ConfirmDialog.tsx` and was imported from there by `RowMenu.tsx`. The
 * import was type-only and therefore free at runtime, but it still said something untrue about the
 * package: that a host wanting only a row menu depends on the confirm dialog. In a layer whose
 * whole premise is "take the pieces you need", that is the wrong signal to send.
 *
 * Named for what it holds rather than the bare `types.ts` it arrived as: this package has ~40
 * feature domains carrying a `types.ts` apiece, so an unqualified one sitting beside the flat
 * components would read as "the React layer's types" — far broader than the three-value enum and
 * two helpers actually here.
 */

/**
 * The three action tiers this vocabulary distinguishes: `"default"` for a neutral action,
 * `"warning"` for reversible-but-access-affecting ones (e.g. Disable), `"danger"` for genuinely
 * destructive ones (e.g. Delete).
 *
 * Deliberately shared between `ConfirmDialog` and `RowMenu`: a caller wiring up "Disable opens
 * nothing, Delete opens a ConfirmDialog" from one item list should not have to reconcile two tone
 * enums to keep the colors matching.
 */
export type ConfirmTone = 'default' | 'warning' | 'danger';

/** Maps a tone onto the class name the host stylesheet is expected to define. `"default"` yields
 *  `undefined` — the plain button, no class. */
export function toneClassName(tone: ConfirmTone): string | undefined {
  if (tone === 'danger') return 'btn-danger';
  if (tone === 'warning') return 'btn-warning';
  return undefined;
}

/** `tone` wins when both `tone` and the deprecated `destructive` are passed; `destructive: true`
 *  alone still maps to `"danger"` (its only prior meaning) for callers that haven't migrated. */
export function resolveTone(source: { tone?: ConfirmTone; destructive?: boolean }): ConfirmTone {
  return source.tone ?? (source.destructive ? 'danger' : 'default');
}

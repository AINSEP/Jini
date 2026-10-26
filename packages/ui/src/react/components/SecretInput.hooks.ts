import { useState } from 'react';

export interface SecretRevealRequired {
  /** The input's current value. A transition to `''` re-hides (the usual sign a save succeeded). */
  readonly value: unknown;
  /** The toggle's full accessible names, translated ("Show API key" / "Hide API key"). */
  readonly labels: { readonly show: string; readonly hide: string };
}

export interface SecretRevealOptional {
  /** Controlled mode: the host owns the shown/hidden state (e.g. to reset it per provider). */
  readonly revealed?: boolean;
  readonly onRevealedChange?: (revealed: boolean) => void;
}

/**
 * The show/hide state behind `SecretInput`'s eye toggle. Starts hidden. Uncontrolled, it re-hides on
 * the value's transition to empty only — an empty field may still be revealed before pasting.
 * @complexity O(1).
 */
export function useSecretReveal(required: SecretRevealRequired, optional: SecretRevealOptional = {}) {
  const [ownRevealed, setOwnRevealed] = useState(false);
  const [lastValue, setLastValue] = useState(required.value);
  if (required.value !== lastValue) {
    setLastValue(required.value);
    if (required.value === '') setOwnRevealed(false);
  }
  const revealed = optional.revealed ?? ownRevealed;
  const toggleLabel = revealed ? required.labels.hide : required.labels.show;
  const toggle = () => {
    if (optional.onRevealedChange) optional.onRevealedChange(!revealed);
    else setOwnRevealed(!revealed);
  };
  return { revealed, inputType: revealed ? 'text' : 'password', toggleLabel, toggle } as const;
}

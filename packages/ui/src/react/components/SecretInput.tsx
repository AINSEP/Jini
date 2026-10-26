import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { useT } from '../../features/i18n/index.js';
import { Icon } from './Icon.js';
import { useSecretReveal } from './SecretInput.hooks.js';

/**
 * @file The shared masked input: a password/token/key `<input>` with an eye toggle inside its right
 * edge. Drop-in for `<input type="password">` — every other input prop passes straight through.
 *
 * Same markup and classes as `@jini-ai/ui-kit`'s password `TextField` and the mcp-ui secret fields
 * (`.jini-secret` / `.jini-secret-toggle`), so one host stylesheet styles all of them; hosts own
 * the visual rules.
 *
 * Keep it OUT of a wrapping `<label>`: the toggle's "Show <label>" name would join the input's own
 * accessible name. Pair it with a sibling `<label htmlFor>` (or `aria-label`) instead.
 */
export interface SecretInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The field's visible label, translated; names the toggle ("Show API key"). */
  readonly label: string;
  /** The toggle's full names, for a host with its own translator (chat, user-management). Default:
   *  `t('Show')`/`t('Hide')` + `label`, from this package's `I18nProvider`. Same contract as
   *  ui-kit `TextField`'s `secretToggleLabels`. */
  readonly toggleLabels?: { readonly show: string; readonly hide: string };
  /** Extra attributes for the toggle button, e.g. an agent handle. */
  readonly toggleAttrs?: Readonly<Record<string, string | boolean | undefined>>;
  /** Controlled mode: the host owns the shown/hidden state. */
  readonly revealed?: boolean;
  readonly onRevealedChange?: (revealed: boolean) => void;
}

export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(
  { label, toggleLabels, toggleAttrs, revealed, onRevealedChange, ...inputProps },
  ref,
) {
  const t = useT();
  const reveal = useSecretReveal(
    { value: inputProps.value, labels: toggleLabels ?? { show: `${t('Show')} ${label}`, hide: `${t('Hide')} ${label}` } },
    { ...(revealed === undefined ? {} : { revealed }), ...(onRevealedChange ? { onRevealedChange } : {}) },
  );
  return (
    <span className="jini-secret">
      {/* spellCheck off: once revealed as type="text", enhanced spellcheck would send the secret out. */}
      <input spellCheck={false} {...inputProps} ref={ref} type={reveal.inputType} />
      <button
        type="button"
        className="jini-secret-toggle"
        aria-label={reveal.toggleLabel}
        aria-pressed={reveal.revealed}
        title={reveal.toggleLabel}
        disabled={inputProps.disabled}
        onClick={reveal.toggle}
        {...toggleAttrs}
      >
        <Icon name={reveal.revealed ? 'eye-off' : 'eye'} size={18} />
      </button>
    </span>
  );
});

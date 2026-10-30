import { forwardRef, type InputHTMLAttributes } from 'react';
import { useSecretReveal, type SecretRevealOptional } from './secret-reveal.hooks.js';
import { eyeIcon } from './native/Controls.hooks.js';

export interface SecretInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>, SecretRevealOptional {
  readonly label: string;
  readonly toggleLabels?: { readonly show: string; readonly hide: string };
  readonly toggleAttrs?: Readonly<Record<string, string | boolean | undefined>>;
}

/** Masked native input with controlled or local reveal state. Keep its toggle outside a label:
 * the toggle's name must never join the input's accessible name. Hosts own styling and copy.
 * @complexity O(1). */
export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(props, ref) {
  // The toggle props are pulled off so they never reach the DOM `<input>`.
  const { label, toggleLabels, toggleAttrs, revealed, onRevealedChange, ...inputProps } = props;
  const reveal = useSecretReveal({ value: inputProps.value, labels: toggleLabels ?? { show: `Show ${label}`, hide: `Hide ${label}` } },
    { ...(revealed === undefined ? {} : { revealed }), ...(onRevealedChange ? { onRevealedChange } : {}) });
  return <span className="jini-secret">
    {/* spellCheck off: once revealed as type="text", enhanced spellcheck would send the secret out. */}
    <input {...inputProps} spellCheck={false} ref={ref} type={reveal.inputType}/>
    {/* One signal only: the Show/Hide name carries state; aria-pressed would announce it twice. */}
    <button {...toggleAttrs} type="button" className="jini-secret-toggle" aria-label={reveal.toggleLabel}
      title={reveal.toggleLabel} disabled={inputProps.disabled} onClick={reveal.toggle}>
      {eyeIcon({ revealed: reveal.revealed })}
    </button>
  </span>;
});

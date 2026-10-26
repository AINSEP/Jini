import { forwardRef } from 'react';
import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
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
 *
 * `SecretTextarea` is the multi-line twin (a `<textarea>` cannot be `type="password"`, so it masks
 * with `-webkit-text-security` while hidden); its wrapper adds `.jini-secret--multiline` so a host
 * can pin the toggle to the top corner instead of the vertical middle.
 */
/** The props both secret fields share: how the eye toggle is named and whether it starts shown. */
interface SecretToggleProps {
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

export type SecretInputProps = SecretToggleProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export type SecretTextareaProps = SecretToggleProps & TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Safe replacement text while hidden (e.g. env names with masked values). Read-only while
   *  displayed: editing replacement characters would overwrite the actual secret. */
  readonly maskedValue?: string | undefined;
};

/** Reveal state + the eye button, shared by `SecretInput` and `SecretTextarea`. */
function useSecretToggle(
  { label, toggleLabels, toggleAttrs, revealed, onRevealedChange }: SecretToggleProps,
  { value, disabled }: { readonly value?: unknown; readonly disabled?: boolean | undefined } = {},
) {
  const t = useT();
  const reveal = useSecretReveal(
    { value, labels: toggleLabels ?? { show: `${t('Show')} ${label}`, hide: `${t('Hide')} ${label}` } },
    { ...(revealed === undefined ? {} : { revealed }), ...(onRevealedChange ? { onRevealedChange } : {}) },
  );
  const button = (
    <button
      {...toggleAttrs}
      type="button"
      className="jini-secret-toggle"
      aria-label={reveal.toggleLabel}
      aria-pressed={reveal.revealed}
      title={reveal.toggleLabel}
      disabled={disabled}
      onClick={reveal.toggle}
    >
      <Icon name={reveal.revealed ? 'eye-off' : 'eye'} size={18} />
    </button>
  );
  return { reveal, button } as const;
}

export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(props, ref) {
  // The toggle props are pulled off so they never reach the DOM `<input>`.
  const { label, toggleLabels, toggleAttrs, revealed, onRevealedChange, ...inputProps } = props;
  const { reveal, button } = useSecretToggle(props, { value: inputProps.value, disabled: inputProps.disabled });
  return (
    <span className="jini-secret">
      {/* spellCheck off: once revealed as type="text", enhanced spellcheck would send the secret out. */}
      <input {...inputProps} spellCheck={false} ref={ref} type={reveal.inputType} />
      {button}
    </span>
  );
});

export const SecretTextarea = forwardRef<HTMLTextAreaElement, SecretTextareaProps>(function SecretTextarea(props, ref) {
  const { label, toggleLabels, toggleAttrs, revealed, onRevealedChange, style, maskedValue, ...textareaProps } = props;
  const { reveal, button } = useSecretToggle(props, { value: textareaProps.value, disabled: textareaProps.disabled });
  const replacementShown = !reveal.revealed && maskedValue !== undefined;
  /* Not a standard CSS property, so it is set here rather than left to a host stylesheet: a host
     that forgot it would show the secret in clear text. pre-wrap keeps line breaks while masked. */
  const masked: CSSProperties = { ...style, ...({ WebkitTextSecurity: reveal.revealed || replacementShown ? 'none' : 'disc' } as CSSProperties), whiteSpace: 'pre-wrap' };
  return (
    <span className="jini-secret jini-secret--multiline">
      <textarea {...textareaProps} {...(replacementShown ? { value: maskedValue, readOnly: true } : {})} spellCheck={false} ref={ref} style={masked} />
      {button}
    </span>
  );
});

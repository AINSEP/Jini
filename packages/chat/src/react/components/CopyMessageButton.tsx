/** Shared message-copy affordance for ordinary messages and mid-run user receipts. */
import { useT } from '../hooks/context.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { Icon } from './Icon.js';

interface CopyMessageButtonProps {
  /** The raw markdown source to place on the clipboard — never rendered/flattened text. */
  text: string;
  /** Accessible name while idle; swaps to a "Copied" label once the copy lands. */
  label: string;
}

/**
 * Quiet, icon-only copy affordance shared by the user- and assistant-message
 * action rows. Delegates the actual clipboard write (and its
 * secure-context fallback) to `useCopyToClipboard`; this component only owns
 * the icon swap and the accessible announcement of the transient state.
 * @param props.text - Exact string to copy, verbatim.
 * @param props.label - Idle accessible name (already translated by the caller).
 * @complexity O(1) — one child hook call, no branching beyond the copied-state read.
 */
export function CopyMessageButton({ text, label }: CopyMessageButtonProps) {
  const t = useT();
  const { copied, copy } = useCopyToClipboard();
  return (
    <>
      <button
        type="button"
        className="jini-message-action-btn"
        aria-label={copied ? t('Copied') : label}
        onClick={() => {
          void copy(text);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {/* Visually hidden, not decorative: the icon swap above says nothing to a screen reader on
          its own, so this polite live region announces the same transient state in words. */}
      <span className="jini-message-copy-status" aria-live="polite">
        {copied ? t('Copied to clipboard') : ''}
      </span>
    </>
  );
}

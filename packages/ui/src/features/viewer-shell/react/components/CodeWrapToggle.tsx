import { agentHandle } from '@jini-ai/agentic';
import type { Translate } from '../../../i18n/dictionary-translator.js';

export interface CodeWrapToggleProps {
  wrap: boolean;
  onToggle: () => void;
  /** Labels: "Wrap: on" / "Wrap: off" keys from the host's dictionary. */
  t: Translate;
  agentHandleId: string;
  className?: string;
}

/** "Wrap: on" / "Wrap: off" — a pressed-state toggle for {@link CodeWithLines}'s `wrap`. */
export function CodeWrapToggle({ wrap, onToggle, t, agentHandleId, className }: CodeWrapToggleProps) {
  return (
    <button
      type="button"
      className={className}
      aria-pressed={wrap}
      onClick={onToggle}
      {...agentHandle({ handle: agentHandleId }, { role: 'button', label: 'Toggle line wrapping for this file' })}
    >
      {wrap ? t('Wrap: on') : t('Wrap: off')}
    </button>
  );
}

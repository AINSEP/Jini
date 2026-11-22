import { agentHandle } from '@jini-ai/core/agent-handles';

import { type Translate } from '@jini-ai/core/text';
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

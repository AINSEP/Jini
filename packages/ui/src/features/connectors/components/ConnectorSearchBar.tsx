import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useT } from '../../i18n/index.js';
import { Icon } from '../../../react/components/Icon.js';

export interface ConnectorSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onFocus?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  clearAriaLabel?: string;
  /** This search bar's own agent handle — see `ConnectorsBrowser`'s `agentHandle` doc. */
  agentHandle?: string;
}

export function ConnectorSearchBar({
  value,
  onChange,
  disabled = false,
  onFocus,
  placeholder,
  ariaLabel,
  clearAriaLabel,
  agentHandle,
}: ConnectorSearchBarProps) {
  const t = useT();
  const resolvedPlaceholder = placeholder ?? t('Search connectors');
  const resolvedAriaLabel = ariaLabel ?? t('Search connectors');
  const resolvedClearAriaLabel = clearAriaLabel ?? t('Clear search');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = value.trim().length > 0;

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      event.stopPropagation();
      onChange('');
    }
  }

  return (
    <div className="toolbar-search connectors-search">
      <span className="search-icon" aria-hidden>
        <Icon name="search" size={13} />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={resolvedPlaceholder}
        aria-label={resolvedAriaLabel}
        disabled={disabled}
        data-testid="connectors-search-input"
        {...agentHandleProps(agentHandle, { role: 'field', label: resolvedAriaLabel })}
      />
      {hasQuery ? (
        <button
          type="button"
          className="toolbar-search-clear"
          aria-label={resolvedClearAriaLabel}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          data-testid="connectors-search-clear"
          {...agentHandleProps(agentHandle, { action: 'clear', role: 'button', label: resolvedClearAriaLabel })}
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

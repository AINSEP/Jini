import { agentHandleProps } from '@jini-ai/core/agent-handles';
import { useT } from '../../i18n/index.js';
import { Icon } from '../../../react/components/Icon.js';
import { useConnectorSearchBar } from './ConnectorSearchBar.hooks.js';

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
  useTHook?: typeof useT;
  useConnectorSearchBarHook?: typeof useConnectorSearchBar;
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
  useTHook = useT,
  useConnectorSearchBarHook = useConnectorSearchBar,
}: ConnectorSearchBarProps) {
  const t = useTHook();
  const resolvedPlaceholder = placeholder ?? t('Search connectors');
  const resolvedAriaLabel = ariaLabel ?? t('Search connectors');
  const resolvedClearAriaLabel = clearAriaLabel ?? t('Clear search');
  const { inputRef, hasQuery, onKeyDown } = useConnectorSearchBarHook({ value, onChange });

  return (
    <div className="jini-ui-toolbar-search jini-ui-connectors-search">
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
        {...agentHandleProps({}, { base: agentHandle, ...({ role: 'field', label: resolvedAriaLabel }) })}
      />
      {hasQuery ? (
        <button
          type="button"
          className="jini-ui-toolbar-search-clear"
          aria-label={resolvedClearAriaLabel}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          data-testid="connectors-search-clear"
          {...agentHandleProps({}, { base: agentHandle, ...({ action: 'clear', role: 'button', label: resolvedClearAriaLabel }) })}
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

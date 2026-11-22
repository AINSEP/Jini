import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ConnectorSearchBarProps } from './ConnectorSearchBar.js';

/** Clear a populated search on Escape and retain the input for focus restoration. */
export function useConnectorSearchBar({ value, onChange }: Pick<ConnectorSearchBarProps, 'value' | 'onChange'>, _options = {}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = value.trim().length > 0;
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      event.stopPropagation();
      onChange('');
    }
  }
  return { inputRef, hasQuery, onKeyDown };
}

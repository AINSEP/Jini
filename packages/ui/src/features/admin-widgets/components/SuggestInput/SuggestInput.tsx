import { useId, useRef, type KeyboardEvent } from 'react';
import { agentHandle } from '@jini-ai/agentic';
import { useScrollHighlightedIntoView, useSuggestInput } from './SuggestInput.hooks.js';

/**
 * A free-text input with a styled suggestion list under it: the browser's native `<datalist>` cannot
 * be styled (Chrome on macOS draws it as a dark bubble with a pointer and adds a large ▼ to the box),
 * so hosts get plain `jini-suggest-input*` classes to style instead. Unlike `Select`, the typed text
 * is the value: picking a suggestion is a shortcut, not the only way to fill it.
 *
 * Keys: ArrowDown/ArrowUp move through matches, Enter picks the highlighted one, Escape closes the
 * list. Any key the list does not consume (Enter with nothing highlighted, a comma, Escape with the
 * list closed) reaches the caller's `onKeyDown`, so "Enter adds what was typed" keeps working.
 * Options are picked on mousedown so the input's blur doesn't close the list before the click lands.
 * Every match is listed unless `limit` is set; the host's max-height makes the list scroll, and an
 * arrow-key move scrolls the highlighted row into view.
 */
export interface SuggestInputProps {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  /** A suggestion was chosen (click or Enter on a highlighted row). */
  onPick: (value: string) => void;
  onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  placeholder?: string | undefined;
  'aria-label'?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** Cap on listed matches; omit to list them all. */
  limit?: number | undefined;
  agentHandle?: string | undefined;
  agentLabel?: string | undefined;
  useSuggest?: typeof useSuggestInput | undefined;
  /** Injectable for tests; defaults to `scrollIntoView({ block: 'nearest' })`. */
  scrollOptionIntoView?: ((option: Element) => void) | undefined;
}

export function SuggestInput({ value, onValueChange, suggestions, onPick, onKeyDown, placeholder, disabled, className, limit, agentHandle: handle, agentLabel, useSuggest = useSuggestInput, scrollOptionIntoView, ...rest }: SuggestInputProps) {
  const vm = useSuggest({ value, suggestions }, { limit });
  const listRef = useRef<HTMLUListElement>(null);
  useScrollHighlightedIntoView({ listRef, scrollTarget: vm.scrollTarget }, { scrollIntoView: scrollOptionIntoView });
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;
  return (
    <span className={className ? `jini-suggest-input ${className}` : 'jini-suggest-input'}>
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={vm.open}
        aria-controls={listId}
        aria-activedescendant={vm.open && vm.highlighted >= 0 ? optionId(vm.highlighted) : undefined}
        aria-label={rest['aria-label']}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        autoComplete="off"
        onChange={(event) => { onValueChange(event.target.value); vm.openList(); }}
        onFocus={vm.openList}
        onBlur={vm.closeList}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            onKeyDown?.(event);
            return;
          }
          const result = vm.handleKey(event.key);
          if (result.consumed) {
            event.preventDefault();
            if (result.picked !== undefined) onPick(result.picked);
            return;
          }
          onKeyDown?.(event);
        }}
        {...(handle ? agentHandle({ handle }, { role: 'field', label: agentLabel ?? rest['aria-label'] ?? 'Text with suggestions' }) : {})}
      />
      {vm.open ? (
        <ul ref={listRef} id={listId} role="listbox" className="jini-suggest-input__list">
          {vm.matches.map((match, index) => (
            <li
              key={match}
              id={optionId(index)}
              role="option"
              aria-selected={index === vm.highlighted}
              className={index === vm.highlighted ? 'jini-suggest-input__option is-active' : 'jini-suggest-input__option'}
              onMouseEnter={() => vm.setHighlighted(index)}
              onMouseDown={(event) => { event.preventDefault(); vm.closeList(); onPick(match); }}
            >
              {match}
            </li>
          ))}
        </ul>
      ) : (
        <ul id={listId} role="listbox" hidden />
      )}
    </span>
  );
}

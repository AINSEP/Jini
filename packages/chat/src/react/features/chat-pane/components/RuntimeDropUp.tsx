import type { ReactNode } from 'react';
import { RemixIcon } from '@jini-ai/ui';

import { useRuntimeDropUp } from '../hooks/useRuntimeDropUp.hooks.js';

export interface RuntimeDropUpProps {
  /** Names both the trigger (with the current value appended) and the menu. */
  label: string;
  /** What the trigger shows: the current choice's display label. */
  valueLabel: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onSelect: (id: string) => void;
  /** Small muted line above the options (e.g. the model catalog's "Cached · …" note). */
  note?: string | undefined;
  /** Menu width cap in px; the menu is also clamped to the viewport. */
  width: number;
  className?: string;
}

/**
 * A compact, borderless "Label ⌄" trigger in the composer bar that opens a menu of choices above
 * itself. Used for the model and the reasoning effort; the selection itself stays with the caller.
 *
 * @complexity Time/space: O(n) in the option count.
 */
export function RuntimeDropUp({
  label,
  valueLabel,
  value,
  options,
  onSelect,
  note,
  width,
  className,
}: RuntimeDropUpProps): ReactNode {
  const {
    menuId,
    open,
    position,
    triggerRef,
    menuRef,
    toggleOpen,
    handleTriggerKeyDown,
    handleMenuKeyDown,
    choose,
  } = useRuntimeDropUp({ width });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`jini-runtime-dropup-trigger${className ? ` ${className}` : ''}`}
        aria-label={`${label}: ${valueLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={valueLabel}
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="jini-runtime-dropup-trigger__label">{valueLabel}</span>
        <RemixIcon name="arrow-down-s-line" size={15} className="jini-runtime-trigger__chevron" />
      </button>
      {open && position ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="jini-runtime-dropup"
          style={position}
          onKeyDown={handleMenuKeyDown}
        >
          {note ? <div className="jini-runtime-dropup__note">{note}</div> : null}
          {options.map((option) => {
            const active = option.id === value;
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`jini-runtime-dropup__item${active ? ' is-active' : ''}`}
                key={option.id}
                onClick={() => choose(() => onSelect(option.id))}
              >
                <span className="jini-runtime-dropup__item-label">{option.label}</span>
                {active ? <RemixIcon name="check-line" size={16} className="jini-runtime-check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

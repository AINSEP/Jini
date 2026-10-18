import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RemixIcon, infoTipBubbleStyle, useInfoTip } from '@jini-ai/ui';

import { useRuntimeDropUp } from '../hooks/useRuntimeDropUp.hooks.js';

export interface RuntimeDropUpProps {
  /** Names both the trigger (with the current value appended) and the menu. */
  label: string;
  /** What the trigger shows: the current choice's display label. */
  valueLabel: string;
  /** A shorter form the trigger shows instead (e.g. "Opus 5.5"); the full `valueLabel` then
   *  appears in a hover/focus tooltip and stays the trigger's accessible name. */
  triggerLabel?: string | undefined;
  value: string;
  options: readonly { id: string; label: string }[];
  onSelect: (id: string) => void;
  /** Small muted line above the options (e.g. the model catalog's "Cached · …" note). */
  note?: string | undefined;
  /** Menu width cap in px; the menu is also clamped to the viewport. */
  width: number;
  className?: string;
  useTip?: typeof useInfoTip | undefined;
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
  triggerLabel,
  value,
  options,
  onSelect,
  note,
  width,
  className,
  useTip = useInfoTip,
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
  // The same white bubble as `InfoTip` (its hook places it), rather than the browser's own title
  // tooltip; only when the trigger shows a shortened label, so there is something to reveal.
  const tip = useTip({}, { placement: 'top' });
  const shortened = triggerLabel !== undefined && triggerLabel !== valueLabel;
  // No tip over the open menu, which already lists the full name.
  const showTip = () => {
    if (shortened && !open) tip.show();
  };

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
        {...(shortened ? {} : { title: valueLabel })}
        onClick={() => {
          tip.hide();
          toggleOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') tip.hide();
          handleTriggerKeyDown(event);
        }}
        onMouseEnter={showTip}
        onMouseLeave={tip.leave}
        onFocus={showTip}
        onBlur={tip.hide}
      >
        <span ref={tip.iconRef} className="jini-runtime-dropup-trigger__label">{triggerLabel ?? valueLabel}</span>
        <RemixIcon name="arrow-down-s-line" size={15} className="jini-runtime-trigger__chevron" />
      </button>
      {tip.open && shortened && !open
        ? createPortal(
            <span
              ref={tip.bubbleRef}
              className={tip.placement === 'below' ? 'info-tip-bubble info-tip-bubble-below' : 'info-tip-bubble'}
              role="presentation"
              aria-hidden="true"
              style={infoTipBubbleStyle(tip.coords)}
            >
              {valueLabel}
            </span>,
            document.body,
          )
        : null}
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

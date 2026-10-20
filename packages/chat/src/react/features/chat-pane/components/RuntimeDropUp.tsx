import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RemixIcon, infoTipBubbleStyle, useInfoTip } from '@jini-ai/ui';

import { useRuntimeDropUp, type UseRuntimeDropUpResult } from '../hooks/useRuntimeDropUp.hooks.js';

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
}

type RuntimeDropUpTip = ReturnType<typeof useInfoTip>;

/** The full `valueLabel` in the same white bubble `InfoTip` uses, portalled to `document.body`. */
function RuntimeDropUpTipBubble({ tip, valueLabel }: { tip: RuntimeDropUpTip; valueLabel: string }): ReactNode {
  return createPortal(
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
  );
}

interface RuntimeDropUpMenuProps {
  dropUp: UseRuntimeDropUpResult;
  label: string;
  value: string;
  options: RuntimeDropUpProps['options'];
  onSelect: (id: string) => void;
  note: string | undefined;
}

function RuntimeDropUpMenu({ dropUp, label, value, options, onSelect, note }: RuntimeDropUpMenuProps): ReactNode {
  if (!dropUp.open || !dropUp.position) return null;
  return (
    <div
      ref={dropUp.menuRef}
      id={dropUp.menuId}
      role="menu"
      aria-label={label}
      className="jini-runtime-dropup"
      style={dropUp.position}
      onKeyDown={dropUp.handleMenuKeyDown}
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
            onClick={() => dropUp.choose(() => onSelect(option.id))}
          >
            <span className="jini-runtime-dropup__item-label">{option.label}</span>
            {active ? <RemixIcon name="check-line" size={16} className="jini-runtime-check" /> : null}
          </button>
        );
      })}
    </div>
  );
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
}: RuntimeDropUpProps): ReactNode {
  const dropUp = useRuntimeDropUp({ width });
  const { menuId, open, triggerRef, toggleOpen, handleTriggerKeyDown } = dropUp;
  // The same white bubble as `InfoTip` (its hook places it), rather than the browser's own title
  // tooltip; only when the trigger shows a shortened label, so there is something to reveal.
  const tip = useInfoTip({}, { placement: 'top' });
  const shortened = triggerLabel !== undefined && triggerLabel !== valueLabel;
  // No tip over the open menu, which already lists the full name.
  const tipVisible = shortened && !open;
  const showTip = () => {
    if (tipVisible) tip.show();
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
      {tip.open && tipVisible ? <RuntimeDropUpTipBubble tip={tip} valueLabel={valueLabel} /> : null}
      <RuntimeDropUpMenu dropUp={dropUp} label={label} value={value} options={options} onSelect={onSelect} note={note} />
    </>
  );
}

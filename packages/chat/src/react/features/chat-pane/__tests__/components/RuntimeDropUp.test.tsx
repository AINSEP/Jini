import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeDropUp, type RuntimeDropUpProps } from '../../components/RuntimeDropUp.js';

const props: RuntimeDropUpProps = {
  label: 'Model',
  valueLabel: 'GPT-5.6-Terra',
  triggerLabel: '5.6 Terra',
  value: 'terra',
  options: [{ id: 'terra', label: 'GPT-5.6-Terra' }],
  onSelect: () => {},
  width: 260,
};

const bubble = () => document.body.querySelector('.info-tip-bubble');

function rect(top: number): DOMRect {
  return { top, bottom: top + 20, left: 400, right: 460, width: 60, height: 20, x: 400, y: top, toJSON: () => ({}) };
}

describe('RuntimeDropUp tooltip bubble', () => {
  afterEach(() => vi.restoreAllMocks());

  it('places the full-name bubble above a trigger that has room above it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(400));
    render(<RuntimeDropUp {...props} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Model: GPT-5.6-Terra' }));
    expect(bubble()).toHaveTextContent('GPT-5.6-Terra');
    expect(bubble()).toHaveAttribute('class', 'info-tip-bubble');
  });

  it('flips the bubble below a trigger at the very top of the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(0));
    render(<RuntimeDropUp {...props} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Model: GPT-5.6-Terra' }));
    expect(bubble()).toHaveAttribute('class', 'info-tip-bubble info-tip-bubble-below');
  });
});

// Demo practice run (2026-11-02): Escape did not close the model picker. The menu used to close only
// from a `document` listener, which never fires when anything between the menu and the document
// stops the keydown. The menu and its trigger now close on Escape themselves.
describe('RuntimeDropUp Escape', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['menu item', 'trigger'])('closes from the focused %s even when an ancestor stops the keydown', (from) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(400));
    render(
      <div onKeyDown={(event) => event.stopPropagation()}>
        <RuntimeDropUp {...props} />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Model: GPT-5.6-Terra' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Model' })).toBeInTheDocument();
    const target = from === 'trigger' ? trigger : screen.getByRole('menuitemradio', { name: 'GPT-5.6-Terra' });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(target, escape);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Consumed, so a host's own Escape (the admin dock closing) leaves it to the menu.
    expect(escape.defaultPrevented).toBe(true);
    expect(trigger).toHaveFocus();
  });
});

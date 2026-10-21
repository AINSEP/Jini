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

/** Every element measures as this 60px-wide box, 400px down the viewport — trigger and composer alike. */
function measureEverythingAt400(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 400, bottom: 420, left: 400, right: 460, width: 60, height: 20, x: 400, y: 400, toJSON: () => ({}),
  });
}

describe('RuntimeDropUp menu placement', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clamps the menu only to the viewport when the trigger sits outside any composer box', () => {
    measureEverythingAt400();
    render(<RuntimeDropUp {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model: GPT-5.6-Terra' }));

    const menu = screen.getByRole('menu');
    // Right-aligned with the trigger (460 - 260), at its full requested width.
    expect(menu.style.left).toBe('200px');
    expect(menu.style.width).toBe('260px');
    expect(menu.style.bottom).toBe(`${window.innerHeight - 400 + 6}px`);
  });

  it('narrows the same menu to the composer box when the trigger sits inside one', () => {
    measureEverythingAt400();
    render(<div className="jini-composer"><RuntimeDropUp {...props} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Model: GPT-5.6-Terra' }));

    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('400px');
    expect(menu.style.width).toBe('60px');
  });
});

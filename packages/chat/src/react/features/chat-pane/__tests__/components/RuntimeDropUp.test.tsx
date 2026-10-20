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

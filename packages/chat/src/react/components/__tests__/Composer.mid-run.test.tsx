import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';

describe('Composer — sending while a run streams', () => {
  it('shows Send beside Stop once there is a draft, and Send sends rather than stops', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() => useComposer());
    act(() => result.current.setDraft('also fix the footer'));
    render(<Composer composer={result.current} onSend={onSend} running onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
  });

  it('shows only Stop while the draft is empty or sending is refused', () => {
    const { result } = renderHook(() => useComposer());
    const { rerender } = render(<Composer composer={result.current} onSend={() => {}} running onCancel={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    act(() => result.current.setDraft('next'));
    rerender(<Composer composer={result.current} onSend={() => {}} running onCancel={() => {}} sendDisabled />);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
  });
});

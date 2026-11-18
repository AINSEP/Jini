import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibecodingWorkbench } from '../VibecodingWorkbench.js';
import type { useVibecodingSession } from '../../use-vibecoding-session.js';

describe('VibecodingWorkbench injected session hook', () => {
  it('renders the undo/redo state and last error of the injected hook and calls its undo', () => {
    const undo = vi.fn(async () => undefined);
    const useFakeSession = vi.fn(() => ({
      parts: [], partContent: new Map(), canUndo: true, canRedo: false, lastError: 'fake session error',
      readPart: vi.fn(async () => ''), undo, redo: vi.fn(async () => undefined),
    })) as unknown as typeof useVibecodingSession;
    render(<VibecodingWorkbench session={{} as never} documentHtml="<p>doc</p>" useVibecodingSessionHook={useFakeSession} />);
    expect(screen.getByText('fake session error')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

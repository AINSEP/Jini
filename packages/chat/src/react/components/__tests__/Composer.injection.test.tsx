import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { useComposerView } from '../Composer.hooks.js';
import { useComposer } from '../../hooks/useComposer.js';

it('uses injected translation, handle and key handling on the draft field', () => {
  const { result } = renderHook(() => useComposer());
  const handleKeyDown = vi.fn();
  const useComposerViewHook: typeof useComposerView = (required) => ({
    ...useComposerView(required), handleKeyDown,
  });
  render(<Composer composer={result.current} onSend={vi.fn()} useAgentHandleHook={() => 'injected-composer'}
    useTHook={() => (key) => `injected:${key}`} useComposerViewHook={useComposerViewHook} />);
  const draft = screen.getByRole('textbox');
  expect(draft).toHaveAttribute('data-agent-label', 'injected:Message draft');
  expect(draft).toHaveAttribute('data-agent-element', 'injected-composer-draft');
  fireEvent.keyDown(draft, { key: 'Enter' });
  expect(handleKeyDown).toHaveBeenCalledOnce();
});

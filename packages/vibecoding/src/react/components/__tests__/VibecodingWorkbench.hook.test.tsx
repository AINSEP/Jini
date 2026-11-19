import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibecodingWorkbench } from '../VibecodingWorkbench.js';
import { createVibecodingSession } from '../../session.js';
import type { EditTarget } from '../../../core/target.js';
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


it('publishes a rejected real read and protects loading and content of a newer selection', async () => {
  const failure = new Error('part read refused');
  let reject!: (error: unknown) => void;
  const pending = new Promise<string>((_resolve, fail) => { reject = fail; });
  let resolveRetry!: (content: string) => void;
  const retry = new Promise<string>(resolve => { resolveRetry = resolve; });
  let resolveB!: (content: string) => void;
  const next = new Promise<string>(resolve => { resolveB = resolve; });
  let aReads = 0;
  const target: EditTarget = {
    listParts: async () => [{ id: 'a' }, { id: 'b' }],
    readPart: vi.fn(({ id }) => id === 'a' ? (++aReads === 1 ? pending : retry) : next),
    replacePart: async () => {}, snapshot: async () => ({ id: 'snapshot', parts: {} }),
    restore: async () => {}, validate: async () => ({ ok: true }),
  };
  const session = createVibecodingSession({ target });
  const errors: (string | undefined)[] = [];
  const unsubscribe = session.subscribe({ listener: () => { errors.push(session.getSnapshot().lastError); } });
  render(<VibecodingWorkbench session={session} />);
  fireEvent.click(await screen.findByRole('button', { name: 'a' }));
  expect(await screen.findByText('Loading…')).toBeInTheDocument();
  await act(async () => { reject(failure); });
  expect(await screen.findByText('part read refused')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  await act(async () => { resolveRetry('obsolete A content'); });
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(screen.queryByText('obsolete A content')).not.toBeInTheDocument();
  await act(async () => { resolveB('B content'); });
  expect(await screen.findByText('B content')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
  expect(errors).toContain('part read refused');
  unsubscribe();
});

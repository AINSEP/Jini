import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorNotice } from '../ErrorNotice.js';

const failure = {
  message: 'The export stopped while building the ZIP.', action: 'Copy details and report this problem.',
  step: 'archive', cause: 'ZIP writer failed', errorId: 'ERR-1234-5678-9ABC-DEF0',
  appVersion: '1', jiniVersion: '2', time: '2026-11-04T12:00:00Z', copyText: 'Step: archive\nCause: ZIP writer failed',
};

describe('ErrorNotice', () => {
  it('shows only the words and error ID in id-only mode', () => {
    const { container } = render(<ErrorNotice failure={failure} disclosure="id-only" />);
    expect(screen.getByText(failure.message)).toBeTruthy();
    expect(screen.getByText(failure.action)).toBeTruthy();
    expect(screen.getByText(`${failure.errorId} — Report this error ID.`)).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
    for (const text of [failure.step, failure.cause, failure.appVersion, failure.jiniVersion, failure.time]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it('shows words without an ID prompt when id-only mode has no error ID', () => {
    const { errorId, ...withoutId } = failure;
    const { container } = render(<ErrorNotice failure={withoutId} disclosure="id-only" />);
    expect(screen.getByText(failure.message)).toBeTruthy();
    expect(screen.getByText(failure.action)).toBeTruthy();
    expect(screen.queryByText(/Report this error ID\./)).toBeNull();
    expect(container.textContent).not.toContain(errorId);
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an accessible native disclosure and copies the same selectable details', async () => {
    const writeText = vi.fn(async () => {});
    render(<ErrorNotice failure={failure} clipboard={{ writeText }} />);
    expect(screen.getByRole('alert').textContent).toContain(failure.message);
    expect(screen.getByText(failure.action)).toBeTruthy();
    expect(screen.getByText('Show details').closest('details')?.open).toBe(false);
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === failure.copyText)).toBeTruthy();
    fireEvent.click(screen.getByText('Show details'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith({ text: failure.copyText }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Copied');
  });

  it('keeps details available and explains manual copying when both clipboard strategies fail', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard blocked'); });
    const fallback = vi.fn(() => false);
    const prior = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback });
    try {
      render(<ErrorNotice failure={failure} clipboard={{ writeText }} t={text => `translated:${text}`} />);
      fireEvent.click(screen.getByText('translated:Show details'));
      fireEvent.click(screen.getByRole('button', { name: 'translated:Copy details' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('translated:Copy failed. Select the details and copy them manually.'));
      expect(fallback).toHaveBeenCalledWith('copy');
      expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === failure.copyText)).toBeTruthy();
    } finally {
      if (prior) Object.defineProperty(document, 'execCommand', prior);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });
});


it('allows history cards to retain polite status semantics and host chrome', () => {
  render(<ErrorNotice failure={failure} role="status" className="notice error" />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').className).toBe('notice error');
});

it('shows no copy feedback when the feedback belongs to an earlier incident', () => {
  const useStale = () => ({ feedback: { text: 'Step: earlier\nCause: other', copied: true }, copy: async () => {} });
  render(<ErrorNotice failure={failure} useErrorNoticeHook={useStale} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Copy details');
});

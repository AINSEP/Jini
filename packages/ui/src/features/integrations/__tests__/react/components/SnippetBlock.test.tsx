import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnippetBlock } from '../../../react/components/SnippetBlock.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SnippetBlock', () => {
  it('renders the snippet text', () => {
    render(<SnippetBlock snippet="hello world" language="bash" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders the placeholder when the snippet is empty', () => {
    render(<SnippetBlock snippet="" language="json" placeholder="Loading…" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('disables the copy button when the snippet is empty', () => {
    render(<SnippetBlock snippet="" language="json" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('copies the snippet and shows "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<SnippetBlock snippet="copy me" language="bash" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('does not show "Copied" when both the Clipboard API and the execCommand fallback fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    // jsdom has no real execCommand implementation to spy on — stub it
    // directly to simulate the fallback also failing (e.g. a locked-down
    // browser context).
    const original = document.execCommand;
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<SnippetBlock snippet="copy me" language="bash" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    document.execCommand = original;
  });

  it('resets the copied state when the snippet changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { rerender } = render(<SnippetBlock snippet="a" language="bash" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    rerender(<SnippetBlock snippet="b" language="bash" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('clears the pending "Copied" reset timer when copy is clicked again before it fires', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<SnippetBlock snippet="copy me" language="bash" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    // Second click while the first "Copied" reset timer is still pending —
    // exercises the `if (timerRef.current) clearTimeout(...)` restart path.
    await userEvent.click(screen.getByRole('button', { name: 'Copied' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

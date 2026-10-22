import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceConfigTestControl } from '../react/components/SourceConfigTestControl.js';

describe('SourceConfigTestControl', () => {
  it('renders idle with a Test button and no status when there is no result yet', () => {
    render(<SourceConfigTestControl running={false} onTest={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls onTest when clicked', async () => {
    const onTest = vi.fn();
    render(<SourceConfigTestControl running={false} onTest={onTest} />);
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('renders a running state with a disabled button', () => {
    render(<SourceConfigTestControl running onTest={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Testing…');
    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
  });

  it('renders a successful result with the message and role="status"', () => {
    render(<SourceConfigTestControl running={false} result={{ ok: true, message: 'Connected in 42ms.' }} onTest={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Connected in 42ms.');
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });

  it('falls back to a default success message when the result omits one', () => {
    render(<SourceConfigTestControl running={false} result={{ ok: true }} onTest={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Connection ok.');
  });

  it('renders a failed result with role="alert" and a Retry button', () => {
    render(<SourceConfigTestControl running={false} result={{ ok: false, message: 'Timed out.' }} onTest={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Timed out.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('falls back to a default failure message when the result omits one', () => {
    render(<SourceConfigTestControl running={false} result={{ ok: false }} onTest={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection failed.');
  });

  it('disables the button when disabled is set, even when not running', () => {
    render(<SourceConfigTestControl running={false} disabled onTest={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
  });
});

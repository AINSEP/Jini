// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemePreviewReloadControl } from '../index.js';

afterEach(cleanup);

const presentation = {
  label: 'Reload fixture previews',
  failureLabel: 'Fixture preview reload failed',
  icon: <span aria-hidden="true">fixture icon</span>,
};

describe('ThemePreviewReloadControl', () => {
  it('uses the supplied accessible name and tooltip with the icon inside the native button', () => {
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={async () => undefined} />);
    const button = screen.getByRole('button', { name: 'Reload fixture previews' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('class')).toBe('theme-explore-fullscreen-trigger');
    expect(button.getAttribute('title')).toBe('Reload fixture previews');
    expect(button.contains(screen.getByText('fixture icon'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls the supplied reload once per enabled click, starting at click time', () => {
    const reloadPreviews = vi.fn(async () => undefined);
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={reloadPreviews} />);
    const button = screen.getByRole('button', { name: 'Reload fixture previews' });
    expect(reloadPreviews).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(reloadPreviews).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(reloadPreviews).toHaveBeenCalledTimes(2);
  });

  it('does not call reload while the native button is disabled', () => {
    const reloadPreviews = vi.fn(async () => undefined);
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={reloadPreviews} disabled />);
    const button = screen.getByRole('button', { name: 'Reload fixture previews' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(reloadPreviews).not.toHaveBeenCalled();
  });

  it('preserves the exact Error message in an alert following the button', async () => {
    const reloadPreviews = vi.fn(() => Promise.reject(new Error('preview host unreachable')));
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={reloadPreviews} />);
    const button = screen.getByRole('button', { name: 'Reload fixture previews' });
    await act(async () => { fireEvent.click(button); });
    const alert = screen.getByRole('alert');
    expect(alert.tagName).toBe('SPAN');
    expect(alert.textContent).toBe('preview host unreachable');
    expect(button.nextElementSibling).toBe(alert);
  });

  it.each([null, 'raw rejection'])('uses the supplied failure label for non-Error rejection %s', async rejection => {
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={() => Promise.reject(rejection)} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload fixture previews' })); });
    expect(screen.getByRole('alert').textContent).toBe('Fixture preview reload failed');
  });

  it('clears the alert on the next click before the retry settles', async () => {
    const reloadPreviews = vi.fn(() => Promise.resolve())
      .mockRejectedValueOnce(new Error('first failure'))
      .mockReturnValueOnce(new Promise<void>(() => {}));
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={reloadPreviews} />);
    const button = screen.getByRole('button', { name: 'Reload fixture previews' });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('alert').textContent).toBe('first failure');
    fireEvent.click(button);
    expect(reloadPreviews).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the injected hook label and alert and invokes its sentinel handler', () => {
    const reload = vi.fn();
    const reloadPreviews = vi.fn(async () => undefined);
    const useReloadHook = vi.fn(() => ({ label: 'Injected reload', reload, error: 'Injected failure' }));
    render(<ThemePreviewReloadControl {...presentation} reloadPreviews={reloadPreviews} useReloadHook={useReloadHook} />);
    const button = screen.getByRole('button', { name: 'Injected reload' });
    expect(button.getAttribute('title')).toBe('Injected reload');
    expect(screen.getByRole('alert').textContent).toBe('Injected failure');
    expect(useReloadHook).toHaveBeenCalledOnce();
    expect(useReloadHook).toHaveBeenCalledWith({
      label: presentation.label, failureLabel: presentation.failureLabel, reloadPreviews,
    });
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledOnce();
    expect(reloadPreviews).not.toHaveBeenCalled();
  });
});

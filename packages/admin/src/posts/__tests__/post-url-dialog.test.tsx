// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostUrlDialog, type PostUrlDialogView } from '../PostUrlDialog.js';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

function view(overrides: Partial<PostUrlDialogView> = {}): PostUrlDialogView {
  return {
    open: true, title: 'Insert image', image: false, url: 'https://', alt: '', error: '', errorId: 'url-err',
    pending: false, invalid: false, disabled: false,
    cancel: vi.fn(), submit: vi.fn((e) => e.preventDefault()), changeUrl: vi.fn(), changeAlt: vi.fn(),
    ...overrides,
  };
}

describe('PostUrlDialog', () => {
  it('renders nothing while the controller is closed', () => {
    const { container } = render(<PostUrlDialog dialog={view({ open: false })} t={t} />);
    expect(container.innerHTML).toBe('');
    expect(document.querySelector('.jini-post-url-dialog')).toBeNull();
  });

  it('renders the translated title under the jini dialog class and forwards URL edits', () => {
    const dialog = view();
    render(<PostUrlDialog dialog={dialog} t={t} />);
    expect(document.querySelector('.jini-post-url-dialog')).not.toBeNull();
    expect(screen.getByText('~Insert image')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '~URL' }), { target: { value: 'https://x.test' } });
    expect(dialog.changeUrl).toHaveBeenCalledWith(expect.objectContaining({ value: 'https://x.test' }));
    expect(screen.queryByRole('textbox', { name: '~Alt text (optional)' })).toBeNull();
  });

  it('shows the translated error tied to the URL field and an alt field for images', () => {
    render(<PostUrlDialog dialog={view({ image: true, error: 'Bad URL', invalid: true })} t={t} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('~Bad URL');
    const url = screen.getByRole('textbox', { name: '~URL' });
    expect(url.getAttribute('aria-describedby')).toBe('url-err');
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: '~Alt text (optional)' })).toBeTruthy();
  });

  it('routes Insert to submit and Cancel to cancel', () => {
    const dialog = view();
    render(<PostUrlDialog dialog={dialog} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: '~Insert' }));
    expect(dialog.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '~Cancel' }));
    expect(dialog.cancel).toHaveBeenCalled();
  });
});

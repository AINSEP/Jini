// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostSettingsDialog, type PostSettingsDialogProps } from '../PostSettingsDialog.js';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

function renderDialog(overrides: Partial<PostSettingsDialogProps> = {}) {
  const onKeyDown = vi.fn();
  const props: PostSettingsDialogProps = {
    hooks: { useTabBarKeyboard: vi.fn(() => ({ onKeyDown })) },
    dialog: { open: true, tab: 'author', setTab: vi.fn(), openDialog: vi.fn(), closeDialog: vi.fn() },
    kindLabel: 'post', author: 'Ada', setAuthor: vi.fn(), showAuthor: true, setShowAuthor: vi.fn(),
    publishAtInput: '', setPublishAtInput: vi.fn(), scheduled: false, t,
    ...overrides,
  };
  return { props, onKeyDown, ...render(<PostSettingsDialog {...props} />) };
}

describe('PostSettingsDialog', () => {
  it('calls the injected tab keyboard hook even while closed, and renders nothing then', () => {
    const { props, container } = renderDialog({ dialog: { open: false, tab: 'author', setTab: vi.fn(), openDialog: vi.fn(), closeDialog: vi.fn() } });
    expect(props.hooks.useTabBarKeyboard).toHaveBeenCalledWith(expect.objectContaining({ activeId: 'author' }));
    expect(container.innerHTML).toBe('');
  });

  it('renders the kind-aware title, jini classes and the author tab panel', () => {
    renderDialog({ kindLabel: 'page' });
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('~Page settings');
    expect(document.querySelector('.jini-post-settings-dialog')).not.toBeNull();
    expect(document.querySelector('.jini-post-settings-tabs')).not.toBeNull();
    expect(document.querySelector('.jini-post-settings-panel input')).not.toBeNull();
    expect(document.querySelector('.jini-post-dialog.jini-post-settings-dialog')).not.toBeNull();
    expect(document.querySelector('.jini-post-settings-dialog__footer > .jini-post-settings-dialog__actions button')?.textContent).toBe('~Done');
    expect(screen.getAllByRole('tab').map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['~Author', 'true'], ['~Publish', 'false'],
    ]);
  });

  it('routes tab clicks, keyboard and Done to the controller and hook', () => {
    const { props, onKeyDown } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: '~Publish' }));
    expect(props.dialog.setTab).toHaveBeenCalledWith('publish');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onKeyDown).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '~Done' }));
    expect(props.dialog.closeDialog).toHaveBeenCalled();
  });

  it('emits only jini-* classes (the host twins its own chrome onto them)', () => {
    renderDialog();
    const classes = [...document.querySelectorAll('[class]')].flatMap((element) => [...element.classList]);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((name) => !name.startsWith('jini-'))).toEqual([]);
  });
});

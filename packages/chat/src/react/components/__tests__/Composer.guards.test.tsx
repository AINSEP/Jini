import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';
import type { ComposerDiscoveryGroup } from '../../slots.js';

type Props = Omit<ComposerProps, 'composer' | 'onSend'> & { onSend?: () => void };
function Harness({ onSend = () => {}, ...props }: Props) {
  const composer = useComposer();
  return <Composer composer={composer} onSend={onSend} {...props} />;
}

const GROUPS: readonly ComposerDiscoveryGroup[] = [
  { id: 'g', label: 'G', items: [{ id: 'wc', label: 'Word Count', kind: 'plugin', insertText: 'Word Count plugin' }] },
];

function openAddMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
  return screen.getByRole('menu', { name: 'Add context' });
}

afterEach(() => vi.restoreAllMocks());

describe('Composer guards', () => {
  it('reports a host effect that throws synchronously and keeps rendering', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('sync boom');
    render(<Harness slots={{ plusMenuItems: [{ id: 'p', label: 'Boom', onSelect: () => { throw failure; } }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Boom' }));
    expect(error).toHaveBeenCalledWith('[@jini-ai/chat] Composer plusMenuItems.onSelect host effect failed:', failure);
    expect(screen.getByRole('button', { name: 'Boom' })).toBeInTheDocument();
  });

  it('renders the footer-leading accessory slot', () => {
    const { container } = render(<Harness slots={{ footerLeadingAccessory: <b>lead</b> }} />);
    expect(container.querySelector('.jini-composer-footer-leading')?.textContent).toBe('lead');
  });

  it('leaves popovers alone when the textarea is not inside a .jini-composer root', () => {
    const closest = Element.prototype.closest;
    vi.spyOn(Element.prototype, 'closest').mockImplementation(function (this: Element, selector: string) {
      return selector === '.jini-composer' ? null : closest.call(this, selector);
    });
    render(<Harness slots={{ discoveryGroups: GROUPS }} />);
    const menu = openAddMenu();
    expect(menu.getAttribute('style')).toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole('menu', { name: 'Add context' })).toBeInTheDocument();
  });

  it('ignores an outside mousedown that carries no target', () => {
    render(<Harness slots={{ discoveryGroups: GROUPS }} />);
    openAddMenu();
    const event = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: null });
    act(() => { document.dispatchEvent(event); });
    expect(screen.getByRole('menu', { name: 'Add context' })).toBeInTheDocument();
  });

  it('closes the working-directory popover on an outside mousedown', () => {
    render(<Harness onChangeWorkingDirectory={() => {}} />);
    fireEvent.click(screen.getByTestId('composer-workdir-trigger'));
    expect(screen.getByTestId('composer-workdir-panel')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('composer-workdir-panel'));
    expect(screen.getByTestId('composer-workdir-panel')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('composer-workdir-panel')).not.toBeInTheDocument();
  });

  it('keeps the draft when the host outcome carries no draft', async () => {
    render(<Harness slots={{ discoveryGroups: GROUPS, onDiscoverySelect: () => Promise.resolve({}) }} />);
    openAddMenu();
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Word Count/ })); });
    expect(screen.getByRole('textbox')).toHaveValue('Word Count plugin');
  });

  it('appends a plus-menu item\'s insertText to the existing draft', () => {
    render(<Harness slots={{ discoveryGroups: GROUPS }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi ' } });
    openAddMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Word Count/ }));
    expect(screen.getByRole('textbox')).toHaveValue('hi Word Count plugin');
  });

  it('a plus-menu item with no insertText leaves the draft as typed and still notifies the host', () => {
    const onDiscoverySelect = vi.fn();
    render(<Harness slots={{ discoveryGroups: [{ id: 'g', label: 'G', items: [{ id: 'open', label: 'Open settings', kind: 'mcp' }] }], onDiscoverySelect }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep' } });
    openAddMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Open settings/ }));
    expect(screen.getByRole('textbox')).toHaveValue('keep');
    expect(onDiscoverySelect).toHaveBeenCalledWith({ item: expect.objectContaining({ id: 'open' }), source: 'plus' });
  });

  it('a discovery host effect that throws synchronously is reported and does not block the next pick', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDiscoverySelect = vi.fn(() => { throw new Error('sync'); });
    render(<Harness slots={{ discoveryGroups: GROUPS, onDiscoverySelect }} />);
    openAddMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Word Count/ }));
    openAddMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Word Count/ }));
    expect(onDiscoverySelect).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('does not send on Enter while the composer is disabled', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} disabled />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'x' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('treats a paste with no clipboardData as an ordinary paste', () => {
    const onFiles = vi.fn();
    render(<Harness attachmentPicker={{ onFiles }} />);
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    act(() => { screen.getByRole('textbox').dispatchEvent(pasteEvent); });
    expect(onFiles).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(false);
  });
});

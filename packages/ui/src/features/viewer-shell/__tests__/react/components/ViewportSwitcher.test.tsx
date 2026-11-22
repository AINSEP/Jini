import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEWPORT_PRESETS } from '../../../constants.js';
import { ViewportSwitcher } from '../../../react/components/ViewportSwitcher.js';
import { I18nProvider, type useT } from '../../../../i18n/index.js';

describe('ViewportSwitcher', () => {
  it('shows the active preset label on the trigger', () => {
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="tablet" onViewport={() => {}} ariaLabel="Viewport" />);
    expect(screen.getByRole('button', { name: 'Viewport' })).toHaveTextContent('Tablet');
  });

  it('opens the listbox on click and lists every preset', async () => {
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="desktop" onViewport={() => {}} ariaLabel="Viewport" />);
    await userEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('calls onViewport and closes when an option is picked', async () => {
    const onViewport = vi.fn();
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="desktop" onViewport={onViewport} ariaLabel="Viewport" />);
    await userEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    await userEvent.click(screen.getByRole('option', { name: /Mobile/ }));
    expect(onViewport).toHaveBeenCalledWith('mobile');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="desktop" onViewport={() => {}} ariaLabel="Viewport" />);
    await userEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on an outside pointer-down', async () => {
    render(
      <div>
        <button>outside</button>
        <ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="desktop" onViewport={() => {}} ariaLabel="Viewport" />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks the selected option in the list', async () => {
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="mobile" onViewport={() => {}} ariaLabel="Viewport" />);
    await userEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    expect(screen.getByRole('option', { name: /Mobile/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Desktop/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('falls back to the first preset when `viewport` matches none of them', () => {
    render(<ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="does-not-exist" onViewport={() => {}} ariaLabel="Viewport" />);
    expect(screen.getByRole('button', { name: 'Viewport' })).toHaveTextContent('Desktop');
  });

  it('renders nothing given an empty preset list', () => {
    const { container } = render(<ViewportSwitcher presets={[]} viewport="desktop" onViewport={() => {}} ariaLabel="Viewport" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders without an icon and falls back title to label when a preset omits both', async () => {
    const presets = [
      { id: 'plain', label: 'Plain', width: null, height: null },
      { id: 'other', label: 'Other', width: null, height: null },
    ];
    render(<ViewportSwitcher presets={presets} viewport="plain" onViewport={() => {}} ariaLabel="Viewport" />);
    const trigger = screen.getByRole('button', { name: 'Viewport' });
    expect(trigger).toHaveAttribute('title', 'Plain');
    expect(trigger.querySelector('svg, img, i')).toBeNull();
    await userEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'Other' });
    expect(option).toHaveAttribute('title', 'Other');
  });

  it('hands its dismiss behaviour to the injected hook', () => {
    const useDismissOnOutsideOrEscapeHook = vi.fn();
    render(
      <ViewportSwitcher presets={DEFAULT_VIEWPORT_PRESETS} viewport="desktop" onViewport={() => {}} ariaLabel="Viewport" useDismissOnOutsideOrEscapeHook={useDismissOnOutsideOrEscapeHook} />,
    );
    expect(useDismissOnOutsideOrEscapeHook).toHaveBeenCalledWith(expect.objectContaining({ onDismiss: expect.any(Function) }), expect.objectContaining({ enabled: false }));
  });
});

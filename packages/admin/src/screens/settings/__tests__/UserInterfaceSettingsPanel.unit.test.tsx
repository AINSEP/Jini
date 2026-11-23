// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserInterfaceSettingsPanel, type UserInterfaceSettingsPanelTab } from '../UserInterfaceSettingsPanel.js';

/**
 * @file Settings → User Interface's two switches over an injected tab hook. The slice is opaque to
 * the panel: the fake hook below receives it untouched and returns the switches' state. The host's
 * suite keeps the cases that run its real hook over its settings slice.
 */

function fakeTab(overrides: Partial<UserInterfaceSettingsPanelTab> = {}): UserInterfaceSettingsPanelTab {
  return { hideChatFabWhileOpen: false, toggleHideChatFabWhileOpen: vi.fn(), wrapTabs: false, toggleWrapTabs: vi.fn(), ...overrides };
}

describe('UserInterfaceSettingsPanel', () => {
  it('hands the slice to the injected hook and reflects its values on the switches', () => {
    const slice = { opaque: true };
    const hook = vi.fn(() => fakeTab({ hideChatFabWhileOpen: true }));
    render(<UserInterfaceSettingsPanel slice={slice} locale="en" useUserInterfaceTabHook={hook} />);
    expect(hook).toHaveBeenCalledWith(slice);
    expect(screen.getByRole('switch', { name: 'Hide the chat button while the chat is open' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Wrap tabs instead of scrolling' }).getAttribute('aria-checked')).toBe('false');
  });

  it('calls only the clicked switch\'s toggle', () => {
    const tab = fakeTab();
    render(<UserInterfaceSettingsPanel slice={null} locale="en" useUserInterfaceTabHook={() => tab} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Wrap tabs instead of scrolling' }));
    expect(tab.toggleWrapTabs).toHaveBeenCalledTimes(1);
    expect(tab.toggleHideChatFabWhileOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'Hide the chat button while the chat is open' }));
    expect(tab.toggleHideChatFabWhileOpen).toHaveBeenCalledTimes(1);
  });

  it('renders only jini-* switch classes and keeps the page-driver handles', () => {
    const { container } = render(<UserInterfaceSettingsPanel slice={null} locale="en" useUserInterfaceTabHook={() => fakeTab()} />);
    const toggles = screen.getAllByRole('switch');
    expect(toggles.map((toggle) => toggle.className)).toEqual(['jini-settings-interface-switch', 'jini-settings-interface-switch']);
    expect(container.querySelectorAll('.jini-settings-interface-switch > .jini-settings-interface-switch-knob[aria-hidden="true"]')).toHaveLength(2);
    expect(toggles.map((toggle) => toggle.getAttribute('data-agent-element'))).toEqual(['settings-interface-hide-chat-fab', 'settings-interface-wrap-tabs']);
    expect(Array.from(container.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList)).every((cls) => cls.startsWith('jini-'))).toBe(true);
  });

  it('translates its copy', () => {
    render(<UserInterfaceSettingsPanel slice={null} locale="es" useUserInterfaceTabHook={() => fakeTab()} />);
    expect(screen.getByRole('switch', { name: 'Ocultar el botón del chat mientras el chat está abierto' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Ajustar las pestañas en varias filas en lugar de desplazarlas' })).toBeTruthy();
  });
});

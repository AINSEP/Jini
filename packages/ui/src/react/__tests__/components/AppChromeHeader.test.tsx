// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { APP_CHROME_FILE_ACTIONS_ID, AppChromeHeader, SettingsIconButton } from '../../components/AppChromeHeader.js';

describe('AppChromeHeader', () => {
  it('omits the back button when onBack is not supplied', () => {
    render(<AppChromeHeader />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a back button that fires onBack and uses the default label', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<AppChromeHeader onBack={onBack} />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Back');
    await user.click(button);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('honors a custom backLabel', () => {
    render(<AppChromeHeader onBack={vi.fn()} backLabel="Back to projects" />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Back to projects');
  });

  it('exposes a stable file-actions mount point', () => {
    const { container } = render(<AppChromeHeader />);
    expect(container.querySelector(`#${APP_CHROME_FILE_ACTIONS_ID}`)).toBeTruthy();
  });

  it('renders content, file-actions-before, and actions, and can hide the traffic space', () => {
    const { container } = render(
      <AppChromeHeader
        showTrafficSpace={false}
        fileActionsBefore={<span data-testid="fab" />}
        actions={<span data-testid="acts" />}
      >
        <span data-testid="kids" />
      </AppChromeHeader>,
    );
    expect(container.querySelector('.jini-app-chrome-traffic-space')).toBeNull();
    expect(screen.getByTestId('kids')).toBeTruthy();
    expect(screen.getByTestId('fab')).toBeTruthy();
    expect(screen.getByTestId('acts')).toBeTruthy();
  });
});

describe('SettingsIconButton', () => {
  it('fires onClick and exposes the given title/aria-label', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<SettingsIconButton onClick={onClick} title="Settings" ariaLabel="Open settings" />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Open settings');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

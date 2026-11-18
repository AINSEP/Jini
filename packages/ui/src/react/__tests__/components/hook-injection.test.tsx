// @vitest-environment jsdom
import { render, screen } from '../../../__tests__/ui-kit-render-support.js';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../../features/i18n/index.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { Notice } from '../../components/Notice.js';
import { OnboardingDropdown, useOnboardingDropdown } from '../../components/OnboardingDropdown.js';
import { PillButton } from '../../components/PillButton.js';
import { PopoverItem } from '../../components/PopoverItem.js';
import { SecretInput } from '../../components/SecretInput.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = { Show: 'Afficher', '{n} warning': '{n} avertissement' };

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

describe('PillButton agent-handle hook', () => {
  it('addresses the button with the handle from the injected hook', () => {
    const useAgentHandleHook = vi.fn(() => 'fake-handle');
    render(<PillButton label="Schedule" onClick={vi.fn()} agentHandle="mine" useAgentHandleHook={useAgentHandleHook} />);
    expect(useAgentHandleHook).toHaveBeenCalledWith(expect.objectContaining({ agentHandle: 'mine' }));
    expect(screen.getByRole('button', { name: 'Schedule' }).outerHTML).toContain('fake-handle');
  });
});

describe('PopoverItem agent-handle hook', () => {
  it('addresses the item with the handle from the injected hook', () => {
    const useAgentHandleHook = vi.fn(() => 'fake-item-handle');
    render(<PopoverItem label="Hourly" onClick={vi.fn()} useAgentHandleHook={useAgentHandleHook} />);
    expect(useAgentHandleHook).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hourly' }).outerHTML).toContain('fake-item-handle');
  });
});

describe('BrandLogo logo hook', () => {
  it('renders the source resolved by the injected hook', () => {
    const { container } = render(<BrandLogo name="Acme" faviconSize={32} useBrandLogoHook={() => ({ src: 'injected.png', fallback: vi.fn() })} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('injected.png');
  });

  it('renders the monogram fallback when the injected hook resolves no source', () => {
    const { container } = render(<BrandLogo name="Acme" faviconSize={32} fallbackClassName="mono" useBrandLogoHook={() => ({ src: null, fallback: vi.fn() })} />);
    expect(container.querySelector('.mono')?.textContent).toBe('A');
  });
});

describe('OnboardingDropdown controller hook', () => {
  it('renders the trigger label produced by the injected controller', () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={[{ value: 'a', label: 'Alpha' }]}
        value=""
        onChange={vi.fn()}
        useOnboardingDropdown={(props) => ({ ...useOnboardingDropdown(props), triggerLabel: 'Injected trigger' })}
      />,
    );
    expect(screen.getByText('Injected trigger')).toBeInTheDocument();
  });
});

describe('Notice translation hook', () => {
  const outcome = { ok: true, message: 'Installed', warnings: ['careful'] };

  it('renders the translator supplied through useTHook', () => {
    render(<Notice outcome={outcome} useTHook={useQuotingT} />);
    expect(screen.getByText(/«\{n\} warning»/)).toBeInTheDocument();
  });

  it('renders the translated, interpolated warning count from the real provider, not the key', () => {
    render(inFrench(<Notice outcome={outcome} />));
    expect(screen.getByText(/1 avertissement/)).toBeInTheDocument();
  });
});

describe('SecretInput translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<SecretInput label="API key" useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Show» API key' })).toBeInTheDocument();
  });

  it('renders the translated toggle label from the real provider, not the key', () => {
    render(inFrench(<SecretInput label="API key" />));
    expect(screen.getByRole('button', { name: 'Afficher API key' })).toBeInTheDocument();
  });
});

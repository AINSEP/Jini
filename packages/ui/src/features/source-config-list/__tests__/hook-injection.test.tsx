import type { ComponentProps } from 'react';
import { render, screen } from '../../../__tests__/ui-kit-render-support.js';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type TranslationDict, type useT } from '../../i18n/index.js';
import { validateSourceDraft } from '../rules.js';
import type { SourceFieldSpec, SourceTrustOption } from '../types.js';
import { SourceConfigAddForm } from '../react/components/SourceConfigAddForm.js';
import { SourceConfigTestControl } from '../react/components/SourceConfigTestControl.js';
import { SourceConfigTrustOptions } from '../react/components/SourceConfigTrustOptions.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: TranslationDict = { 'Add source': 'Ajouter une source', Test: 'Tester', 'Select…': 'Choisir…', Trusted: 'Fiable' };

function inFrench(ui: React.ReactNode) {
  return <I18nProvider dictionaries={{ fr: FR }} initialLocale="fr">{ui}</I18nProvider>;
}

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
const TRUST_OPTIONS: SourceTrustOption[] = [{ value: 'trusted', label: 'Trusted' }];

function addFormProps(): ComponentProps<typeof SourceConfigAddForm> {
  const values = { url: '' };
  return {
    fieldSpecs: [URL_FIELD],
    values,
    validation: validateSourceDraft({ fieldSpecs: [URL_FIELD], values }),
    submitAttempted: false,
    submitting: false,
    onFieldChange: vi.fn(),
    onTrustChange: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe('SourceConfigAddForm translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<SourceConfigAddForm {...addFormProps()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Add source»' })).toBeInTheDocument();
  });

  it('renders the translated submit label from the real provider, not the key', () => {
    render(inFrench(<SourceConfigAddForm {...addFormProps()} />));
    expect(screen.getByRole('button', { name: 'Ajouter une source' })).toBeInTheDocument();
  });
});

describe('SourceConfigTestControl translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<SourceConfigTestControl running={false} onTest={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Test»' })).toBeInTheDocument();
  });

  it('renders the translated button label from the real provider, not the key', () => {
    render(inFrench(<SourceConfigTestControl running={false} onTest={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Tester' })).toBeInTheDocument();
  });
});

describe('SourceConfigTrustOptions translation hook', () => {
  it('renders the translator supplied through useTHook for the placeholder and each option', () => {
    render(<select><SourceConfigTrustOptions trustOptions={TRUST_OPTIONS} useTHook={useQuotingT} /></select>);
    expect(screen.getByText('«Select…»')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '«Trusted»' })).toBeInTheDocument();
  });

  it('renders translated options from the real provider, not the keys', () => {
    render(inFrench(<select><SourceConfigTrustOptions trustOptions={TRUST_OPTIONS} /></select>));
    expect(screen.getByRole('option', { name: 'Fiable' })).toBeInTheDocument();
    expect(screen.getByText('Choisir…')).toBeInTheDocument();
  });
});

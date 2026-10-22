import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { ByokConfig, ProviderPreset } from '../../../types.js';

/**
 * @file The two opt-in host layout props added for Tovu's Visitor AI key step (2026-10-09):
 * `apiKeyActions` (host buttons in a row under the key input, outside any label) and `collapseAdvanced`
 * (Base URL + Max tokens behind an "Advanced" disclosure after Model). Both default off, so
 * every existing mount keeps its layout; `ByokProviderForm.layout.test.tsx` covers that default.
 */
const PRESET: ProviderPreset = {
  id: 'provider-a', title: 'Provider A', protocol: 'anthropic', baseUrl: 'https://a.example.com', preferredModels: ['model-a'],
};
const CONFIG: ByokConfig = {
  protocol: 'anthropic', providerId: 'provider-a', apiKey: 'k', baseUrl: 'https://a.example.com', model: 'model-a',
};

function renderForm(overrides: Partial<Parameters<typeof ByokProviderForm>[0]> = {}) {
  return render(
    <ByokProviderForm config={CONFIG} onConfigChange={vi.fn()} preset={PRESET} modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }} onTestConnection={vi.fn()} {...overrides} />,
  );
}

describe('ByokProviderForm apiKeyActions', () => {
  it('defers missing feedback until each field blurs, while keeping incomplete probes disabled', () => {
    const { rerender } = renderForm({ config: { ...CONFIG, apiKey: '', model: '' }, deferMissingFeedback: true });
    const key = screen.getByLabelText(/API key/);
    const model = screen.getByRole('combobox', { name: /Model/ });
    expect(key).not.toHaveClass('is-missing');
    expect(model).not.toHaveClass('is-missing');
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    fireEvent.blur(key);
    expect(key).toHaveClass('is-missing');
    expect(model).not.toHaveClass('is-missing');
    fireEvent.blur(model);
    expect(model).toHaveClass('is-missing');
    rerender(<ByokProviderForm config={{ ...CONFIG, providerId: 'provider-b', apiKey: '', model: '' }}
      onConfigChange={vi.fn()} preset={{ ...PRESET, id: 'provider-b' }} modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }} onTestConnection={vi.fn()} deferMissingFeedback />);
    expect(key).not.toHaveClass('is-missing');
    expect(model).not.toHaveClass('is-missing');
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('keeps Show on the key input line and puts host buttons in a row under it, outside the key field name', () => {
    renderForm({ apiKeyActions: <button type="button">Save key</button> });
    const input = screen.getByLabelText(/API key/);
    const row = input.closest('.jini-field-input-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Save key' })).toBeNull();
    const actions = row.nextElementSibling as HTMLElement;
    expect(actions).toHaveClass('jini-byok-key-actions');
    expect(within(actions).getByRole('button', { name: 'Save key' })).toBeInTheDocument();
    expect(input).toHaveAccessibleName('API key');
    expect(input.closest('label')).toBeNull();
  });
});

describe('ByokProviderForm collapseAdvanced', () => {
  it('moves Base URL and Max tokens into a closed Advanced disclosure after Model', () => {
    const { container } = renderForm({ collapseAdvanced: true });
    const details = container.querySelector('details.jini-byok-advanced') as HTMLDetailsElement;
    expect(within(details).getByText('Advanced')).toBeInTheDocument();
    expect(details.open).toBe(false);
    expect(within(details).getByRole('textbox', { name: /Base URL/ })).toBeInTheDocument();
    expect(within(details).getByRole('spinbutton', { name: /Max tokens/ })).toBeInTheDocument();
    const model = screen.getByRole('combobox', { name: /Model/ });
    expect(model.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens on its own when Base URL is invalid, so a required-field problem is never hidden', () => {
    const { container } = renderForm({ collapseAdvanced: true, config: { ...CONFIG, baseUrl: 'not a url' } });
    expect((container.querySelector('details.jini-byok-advanced') as HTMLDetailsElement).open).toBe(true);
  });

  it('keeps the original in-place order by default', () => {
    const { container } = renderForm();
    expect(container.querySelector('details.jini-byok-advanced')).toBeNull();
    expect(screen.getByRole('textbox', { name: /Base URL/ })).toBeInTheDocument();
  });
});

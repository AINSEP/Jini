import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { ByokConfig, ProviderPreset } from '../../../types.js';

/**
 * @file The `formFooter` slot — host content at the FOOT of the card, the sibling of the existing
 * `apiKeyFooter` slot directly under the key field.
 *
 * Two slots because a host with a write-only credential store has two distinct saves to offer: one
 * that writes the key (which belongs under the key field, where the operator's cursor is) and one
 * that writes base URL / max tokens / model (which belongs under those, at the foot of the card).
 * Without this slot a host had to either fork the card or hang the second control outside it, where
 * it reads as belonging to the page rather than to the fields it writes.
 */

const PRESET: ProviderPreset = {
  id: 'provider-a',
  title: 'Provider A',
  protocol: 'anthropic',
  baseUrl: 'https://a.example.com',
  preferredModels: ['model-a'],
};

const CONFIG: ByokConfig = {
  protocol: 'anthropic',
  providerId: 'provider-a',
  apiKey: 'k',
  baseUrl: 'https://a.example.com',
  model: 'model-a',
};

function renderForm(props: { apiKeyFooter?: React.ReactNode; formFooter?: React.ReactNode } = {}) {
  return render(
    <ByokProviderForm
      config={CONFIG}
      onConfigChange={vi.fn()}
      preset={PRESET}
      modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }}
      onTestConnection={vi.fn()}
      {...props}
    />,
  );
}

describe('ByokProviderForm formFooter slot', () => {
  it('renders host content at the foot of the card', () => {
    renderForm({ formFooter: <button type="button">Save settings</button> });
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument();
  });

  it('renders nothing extra when omitted', () => {
    const { container } = renderForm();
    expect(container.querySelector('.jini-byok-form-footer')).toBeNull();
  });

  it('places the form footer AFTER the key footer in document order, not merged with it', () => {
    const { container } = renderForm({
      apiKeyFooter: <span>key-slot</span>,
      formFooter: <span>form-slot</span>,
    });
    const keySlot = screen.getByText('key-slot');
    const formSlot = screen.getByText('form-slot');
    // A host puts the key control in one and the settings control in the other; if they collapsed
    // into the same position the split would be invisible to the operator.
    expect(keySlot.compareDocumentPosition(formSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.jini-byok-form-footer')).toContainElement(formSlot);
    expect(container.querySelector('.jini-byok-key-footer')).not.toContainElement(formSlot);
  });
});

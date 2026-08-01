import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { ByokConfig, ProviderPreset } from '@jini-ai/ui-core';

/**
 * @file The credential-reveal toggle's provider scoping.
 *
 * An audit found that `revealKey` is component-local and the card is not keyed
 * by provider, so revealing provider A's key left the toggle on when the
 * operator switched to provider B — and B's own saved key then rendered as
 * `type="text"` without anyone asking for it. The credentials themselves were
 * always correctly compartmentalized per provider; only the disclosure toggle
 * escaped that isolation, which is exactly why it went unnoticed.
 */

const PRESET_A: ProviderPreset = {
  id: 'provider-a',
  title: 'Provider A',
  protocol: 'anthropic',
  baseUrl: 'https://a.example.com',
  preferredModels: ['model-a'],
};

const PRESET_B: ProviderPreset = {
  id: 'provider-b',
  title: 'Provider B',
  protocol: 'openai',
  baseUrl: 'https://b.example.com',
  preferredModels: ['model-b'],
};

function configFor(preset: ProviderPreset, apiKey: string): ByokConfig {
  return {
    protocol: preset.protocol,
    providerId: preset.id,
    apiKey,
    baseUrl: preset.baseUrl,
    model: preset.preferredModels[0] ?? '',
  };
}

function renderForm(config: ByokConfig, preset: ProviderPreset) {
  return render(
    <ByokProviderForm
      config={config}
      onConfigChange={vi.fn()}
      preset={preset}
      modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }}
      onTestConnection={vi.fn()}
    />,
  );
}

function keyInput(): HTMLInputElement {
  return screen.getByLabelText(/API key/i, { exact: false }) as HTMLInputElement;
}

describe('ByokProviderForm — reveal toggle is scoped to one provider', () => {
  it('re-hides when the card switches to a different provider', async () => {
    const { rerender } = renderForm(configFor(PRESET_A, 'key-for-A'), PRESET_A);

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(keyInput()).toHaveAttribute('type', 'text');
    expect(keyInput()).toHaveValue('key-for-A');

    // Operator picks a different preset. The host swaps `config`/`preset` in
    // place — the component is not remounted.
    rerender(
      <ByokProviderForm
        config={configFor(PRESET_B, 'key-for-B')}
        onConfigChange={vi.fn()}
        preset={PRESET_B}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );

    expect(keyInput()).toHaveValue('key-for-B');
    expect(keyInput()).toHaveAttribute('type', 'password');
  });

  it('keeps the key revealed while the operator stays on the same provider', async () => {
    // The fix must not make Show useless — editing the same provider's other
    // fields has to leave the reveal alone.
    const { rerender } = renderForm(configFor(PRESET_A, 'key-for-A'), PRESET_A);

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(keyInput()).toHaveAttribute('type', 'text');

    rerender(
      <ByokProviderForm
        config={{ ...configFor(PRESET_A, 'key-for-A'), model: 'a-different-model' }}
        onConfigChange={vi.fn()}
        preset={PRESET_A}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );

    expect(keyInput()).toHaveAttribute('type', 'text');
  });
});

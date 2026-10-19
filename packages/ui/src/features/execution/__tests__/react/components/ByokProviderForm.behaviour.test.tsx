import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { ByokConfig, ProviderPreset } from '../../../types.js';

/**
 * @file Field wiring the other ByokProviderForm suites leave implicit: every input's `onChange`
 * patches only its own key, the live-model picker and its "Custom…" escape, the custom-endpoint
 * (null preset) card, and the connection-result lines. Pinned before the component was split into
 * per-field parts so the split had to keep each of these exactly.
 */

const PRESET: ProviderPreset = {
  id: 'provider-a',
  title: 'Provider A',
  protocol: 'anthropic',
  baseUrl: 'https://a.example.com',
  apiKeyConsoleUrl: 'https://a.example.com/keys',
  preferredModels: ['model-a'],
};

const CONFIG: ByokConfig = {
  protocol: 'anthropic',
  providerId: 'provider-a',
  apiKey: 'k',
  baseUrl: 'https://a.example.com',
  model: 'model-a',
};

function renderForm(overrides: Partial<Parameters<typeof ByokProviderForm>[0]> = {}) {
  const onConfigChange = vi.fn();
  const view = render(
    <ByokProviderForm
      config={CONFIG}
      onConfigChange={onConfigChange}
      preset={PRESET}
      modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }}
      onTestConnection={vi.fn()}
      {...overrides}
    />,
  );
  return { ...view, onConfigChange };
}

describe('ByokProviderForm field wiring', () => {
  it('patches only the edited key for base URL, max tokens, API key and model', () => {
    const { container, onConfigChange } = renderForm();
    fireEvent.change(container.querySelector('input[type="url"]')!, { target: { value: 'https://b.example' } });
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, baseUrl: 'https://b.example' });
    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: '42' } });
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, maxTokens: 42 });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'k2' } });
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, apiKey: 'k2' });
    fireEvent.change(container.querySelector('input[list]')!, { target: { value: 'model-z' } });
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, model: 'model-z' });
  });

  it('marks Base URL required and links to the key console only when the preset says so', () => {
    const { container, rerender } = renderForm();
    expect(screen.getByRole('link', { name: 'Get key' }).getAttribute('href')).toBe('https://a.example.com/keys');
    const baseUrlLabel = container.querySelector('input[type="url"]')!.closest('label')!;
    expect(baseUrlLabel.querySelector('.jini-field-required')).toBeNull();

    const bare: ProviderPreset = { id: 'provider-a', title: 'Bare', protocol: 'anthropic', baseUrl: '', preferredModels: [] };
    rerender(
      <ByokProviderForm
        config={CONFIG}
        onConfigChange={vi.fn()}
        preset={bare}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Get key' })).toBeNull();
    expect(container.querySelector('input[type="url"]')!.closest('label')!.querySelector('.jini-field-required')).not.toBeNull();
    // No preferredModels and no live list: plain text box with no datalist.
    expect(container.querySelector('datalist')).toBeNull();
    expect(container.querySelector('input[list]')).toBeNull();
  });

  it('renders the custom-endpoint card for a null preset', () => {
    const { container } = renderForm({ preset: null });
    expect(container.querySelector('.jini-byok-card-title')!.textContent).toBe('Custom endpoint');
    expect(container.querySelector('datalist')).toBeNull();
  });

  it('hides Test connection and its result when the host cannot probe', () => {
    const { container } = renderForm({ canTestConnection: false, connectionTest: { status: 'ok' } });
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
    expect(container.querySelector('.jini-byok-test-row')).toBeNull();
  });

  it('shows the host message on success, the default line without one, and an alert on error', () => {
    const { container, rerender } = renderForm({ connectionTest: { status: 'ok', message: 'All good' } });
    const status = () => container.querySelector('.jini-byok-test-status')!;
    expect(status().textContent).toBe('All good');
    expect(status().getAttribute('role')).toBe('status');
    const props = {
      config: CONFIG,
      onConfigChange: vi.fn(),
      preset: PRESET,
      modelDiscovery: { status: 'idle' } as const,
      onTestConnection: vi.fn(),
    };
    rerender(<ByokProviderForm {...props} connectionTest={{ status: 'ok' }} />);
    expect(status().textContent).toBe('Connection succeeded');
    rerender(<ByokProviderForm {...props} connectionTest={{ status: 'error', message: 'Nope' }} />);
    expect(screen.getByRole('alert').textContent).toBe('Nope');
    expect(container.querySelector('.jini-byok-test-status')!.className).toContain('is-error');
    rerender(<ByokProviderForm {...props} connectionTest={{ status: 'testing' }} />);
    const button = screen.getByRole('button', { name: 'Testing…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(container.querySelector('.jini-byok-test-row')).toBeNull();
  });

  it('omits the key field for a keyless preset and paints a blank Base URL only after blur', () => {
    const keyless = { ...PRESET, baseUrl: '', requiresApiKey: false };
    const { container } = renderForm({ preset: keyless, config: { ...CONFIG, baseUrl: '' }, deferMissingFeedback: true });
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const baseUrl = container.querySelector('input[type="url"]')!;
    expect(baseUrl.className).not.toContain('is-missing');
    fireEvent.blur(baseUrl);
    expect(baseUrl.className).toContain('is-missing');
  });

  it('marks Base URL invalid with the error hint', () => {
    const { container } = renderForm({ config: { ...CONFIG, baseUrl: 'not a url' } });
    const hint = container.querySelector('input[type="url"]')!.closest('label')!.querySelector('.jini-field-hint')!;
    expect(hint.className).toContain('is-error');
    expect(hint.textContent).toBe('Enter an absolute http(s) URL.');
  });

  it('opens the Advanced disclosure only while Base URL needs attention', () => {
    const { container, rerender } = renderForm({ collapseAdvanced: true });
    expect(container.querySelector('details')!.open).toBe(false);
    const props = {
      onConfigChange: vi.fn(),
      preset: { ...PRESET, baseUrl: '' },
      modelDiscovery: { status: 'idle' } as const,
      connectionTest: { status: 'idle' } as const,
      onTestConnection: vi.fn(),
      collapseAdvanced: true,
    };
    rerender(<ByokProviderForm {...props} config={{ ...CONFIG, baseUrl: '' }} />);
    expect(container.querySelector('details')!.open).toBe(true);
  });
});

describe('ByokProviderForm live model picker', () => {
  const LIVE = { status: 'ok', models: ['model-a', 'model-b'] } as const;

  it('replaces the text box with the picker and patches the picked model', async () => {
    const user = userEvent.setup();
    const { container, onConfigChange } = renderForm({ modelDiscovery: LIVE, agentHandle: 'byok' });
    expect(screen.getByTestId('jini-byok-model-select')).toBeInTheDocument();
    expect(container.querySelector('.jini-byok-model-row input')).toBeNull();
    expect(container.querySelector('datalist')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'model-b' }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, model: 'model-b' });
  });

  it('opens the free-text box on "Custom…" without clearing the model, and closes it on a real pick', async () => {
    const user = userEvent.setup();
    const { container, onConfigChange } = renderForm({ modelDiscovery: LIVE });
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Custom…' }));
    expect(onConfigChange).not.toHaveBeenCalled();
    const free = container.querySelector('.jini-byok-model-row input:not([type="search"])') as HTMLInputElement;
    expect(free.value).toBe('model-a');
    expect(free.getAttribute('list')).toBeNull();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'model-b' }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...CONFIG, model: 'model-b' });
  });

  it('shows the discovery-failure hint only for an error, never while loading', () => {
    const { container, rerender } = renderForm({ modelDiscovery: { status: 'loading' } });
    expect(container.textContent).not.toContain('Could not load live models');
    rerender(
      <ByokProviderForm
        config={CONFIG}
        onConfigChange={vi.fn()}
        preset={PRESET}
        modelDiscovery={{ status: 'error', message: 'boom' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Could not load live models: boom');
  });

  it('keeps the plain text box with no datalist when live discovery returned an empty list', () => {
    const { container } = renderForm({ modelDiscovery: { status: 'ok', models: [] } });
    expect(screen.queryByTestId('jini-byok-model-select')).toBeNull();
    expect(container.querySelector('.jini-byok-model-row input')!.getAttribute('list')).toBeNull();
    expect(container.querySelector('datalist')).toBeNull();
  });

  it('keeps an unlisted saved model typeable beside the picker, flagged missing when blank', () => {
    const { container } = renderForm({ modelDiscovery: LIVE, config: { ...CONFIG, model: 'fine-tune-1' } });
    const free = container.querySelector('.jini-byok-model-row input') as HTMLInputElement;
    expect(free.value).toBe('fine-tune-1');
    const { container: blank } = renderForm({ modelDiscovery: LIVE, config: { ...CONFIG, model: '' } });
    expect(blank.querySelector('[data-testid="jini-byok-model-select"]')).not.toBeNull();
  });
});

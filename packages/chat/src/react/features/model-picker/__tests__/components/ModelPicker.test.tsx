import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ModelPicker } from '../../components/ModelPicker.js';
import { I18nContext } from '../../../../hooks/context.js';
import type { ModelOption, ModelProvider } from '../../types.js';

const openai: ModelProvider = { id: 'openai', label: 'OpenAI', credentialsRequired: true };
const local: ModelProvider = { id: 'local', label: 'Local', credentialsRequired: false };
const models: ModelOption[] = [
  { id: 'gpt-5', label: 'GPT-5', hint: '4K, native multimodal', providerId: 'openai', default: true },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', providerId: 'openai' },
  { id: 'llama', label: 'Llama', providerId: 'local' },
];

function renderPicker(overrides: Partial<ComponentProps<typeof ModelPicker>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ModelPicker
      label="Model"
      models={models}
      providers={[openai, local]}
      statusByProviderId={{ openai: 'configured', local: 'available' }}
      value="gpt-5"
      onChange={onChange}
      data-testid="mp"
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe('ModelPicker', () => {
  it('renders the label and the selected model title/subtitle on the trigger', () => {
    renderPicker();
    expect(screen.getByText('Model')).toBeInTheDocument();
    const trigger = screen.getByTestId('mp-trigger');
    expect(trigger).toHaveTextContent('GPT-5');
    expect(trigger).toHaveTextContent('OpenAI · 4K, native multimodal');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows placeholder copy and an "is-empty" trigger class when value matches no model', () => {
    renderPicker({ value: 'unknown' });
    const trigger = screen.getByTestId('mp-trigger');
    expect(trigger).toHaveTextContent('No model selected');
    expect(trigger).toHaveTextContent('Choose a model');
    expect(trigger.className).toContain('is-empty');
  });

  it('opens the popover on trigger click, listing provider groups with credential badges', async () => {
    renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.getByTestId('mp-popover')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('marks the default model with a "Recommended" badge and shows model hints when present', async () => {
    renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('4K, native multimodal')).toBeInTheDocument();
    // gpt-5-mini has no hint — its option should render without a hint span.
    expect(screen.getByTestId('mp-option-gpt-5-mini').querySelector('.model-picker-option-hint')).toBeNull();
  });

  it('hides the search input below the searchable-option threshold', async () => {
    renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.queryByTestId('mp-search')).not.toBeInTheDocument();
  });

  it('shows and filters via the search input once the threshold is met', async () => {
    renderPicker({ minSearchableOptions: 2 });
    await userEvent.click(screen.getByTestId('mp-trigger'));
    const search = screen.getByTestId('mp-search');
    await userEvent.type(search, 'mini');
    expect(screen.getByTestId('mp-option-gpt-5-mini')).toBeInTheDocument();
    expect(screen.queryByTestId('mp-option-gpt-5')).not.toBeInTheDocument();
  });

  it('shows the empty-results message when the search matches nothing', async () => {
    renderPicker({ minSearchableOptions: 2 });
    await userEvent.click(screen.getByTestId('mp-trigger'));
    await userEvent.type(screen.getByTestId('mp-search'), 'zzz-no-match');
    expect(screen.getByText('No matching models')).toBeInTheDocument();
  });

  it('selecting an option calls onChange and closes the popover', async () => {
    const { onChange } = renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    await userEvent.click(screen.getByTestId('mp-option-gpt-5-mini'));
    expect(onChange).toHaveBeenCalledWith('gpt-5-mini');
    expect(screen.queryByTestId('mp-popover')).not.toBeInTheDocument();
  });

  it('marks the currently selected option as aria-selected', async () => {
    renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.getByTestId('mp-option-gpt-5')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mp-option-gpt-5-mini')).toHaveAttribute('aria-selected', 'false');
  });

  it('closes when clicking outside the picker', async () => {
    renderPicker();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.getByTestId('mp-popover')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByTestId('mp-popover')).not.toBeInTheDocument();
  });

  /**
   * Proves the i18n wiring actually works — mounts under a real translated
   * dictionary rather than only exercising the unconfigured passthrough
   * case, per the i18n policy in
   * `foundry/docs/jini-port/god-components-extraction-plan.md`.
   */
  it('renders translated copy when an I18nAdapter with a real dictionary is wired in', async () => {
    const dict: Record<string, string> = {
      Model: 'Modell',
      'No matching models': 'Keine passenden Modelle',
      Configured: 'Konfiguriert',
    };
    render(
      <I18nContext.Provider value={{ locale: 'de', t: (key) => dict[key] ?? key }}>
        <ModelPicker
          label="Model"
          models={models}
          providers={[openai, local]}
          statusByProviderId={{ openai: 'configured', local: 'available' }}
          value="unknown"
          onChange={() => {}}
          minSearchableOptions={2}
          data-testid="mp"
        />
      </I18nContext.Provider>,
    );
    expect(screen.getByText('Modell')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('mp-trigger'));
    expect(screen.getByText('Konfiguriert')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('mp-search'), 'zzz-no-match');
    expect(screen.getByText('Keine passenden Modelle')).toBeInTheDocument();
  });

  it('renders without a className modifier or data-testid when none are supplied, and can still be opened/searched/selected', async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        label="Model"
        models={models}
        providers={[openai, local]}
        statusByProviderId={{ openai: 'configured', local: 'available' }}
        value="gpt-5"
        onChange={onChange}
        minSearchableOptions={2}
      />,
    );
    expect(screen.getByText('Model')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /GPT-5/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const search = screen.getByPlaceholderText('Search models');
    await userEvent.type(search, 'mini');
    await userEvent.click(screen.getByRole('option', { name: /GPT-5 mini/i }));
    expect(onChange).toHaveBeenCalledWith('gpt-5-mini');
  });

  it('applies a supplied className to the outer wrapper alongside the base class', () => {
    const { container } = renderPicker({ className: 'my-extra' });
    expect(container.querySelector('.model-picker')?.className).toContain('my-extra');
  });
});

import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProviderChipGroup } from '../../../react/components/ProviderChipGroup.js';
import { SearchableModelSelect } from '../../../react/components/SearchableModelSelect.js';
import { useByokFieldValidation } from '../../../react/hooks/use-byok-field-validation.hooks.js';
import { useLocalCliAgentCard } from '../../../react/hooks/useLocalCliAgentCard.js';
import type { ByokConfig, DetectedAgent } from '../../../types.js';

describe('ProviderChipGroup', () => {
  it('renders no labelled row at all when the catalog half it was given is empty', () => {
    const { container } = render(
      <ProviderChipGroup label="Gateways" presets={[]} selectedPresetId={null} configuredPresetIds={new Set()}
        onSelect={() => {}} configuredLabel="Configured" unsetLabel="Not set" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Gateways')).not.toBeInTheDocument();
  });
});

describe('SearchableModelSelect', () => {
  it('applies a host menu class to the opened listbox', async () => {
    render(
      <SearchableModelSelect models={[{ id: 'm1', label: 'Model One' }]} value="m1" onChange={vi.fn()}
        ariaLabel="Model" searchPlaceholder="Search models" menuClassName="host-model-menu" />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toHaveClass('host-model-menu');
  });
});

describe('useByokFieldValidation', () => {
  it('forgets touched fields when the provider changes, so a new provider starts with no painted errors', () => {
    const blank: ByokConfig = { protocol: 'openai', providerId: 'provider-a', apiKey: '', baseUrl: 'https://example.test', model: '' };
    const { result, rerender } = renderHook(
      ({ config }) => useByokFieldValidation({ config, preset: null, apiKeyStoredExternally: false }, { deferMissingFeedback: true }),
      { initialProps: { config: blank } },
    );
    act(() => { result.current.markTouched({ field: 'apiKey' }); });
    expect(result.current.isMissing({ field: 'apiKey' })).toBe(true);

    rerender({ config: { ...blank, providerId: 'provider-b' } });
    expect(result.current.isMissing({ field: 'apiKey' })).toBe(false);
    act(() => { result.current.markTouched({ field: 'model' }); });
    expect(result.current.isMissing({ field: 'model' })).toBe(true);
    expect(result.current.isMissing({ field: 'apiKey' })).toBe(false);
  });
});

describe('useLocalCliAgentCard', () => {
  it('clears a persisted effort the agent no longer offers, scoped to that agent', () => {
    const agent: DetectedAgent = { id: 'local', label: 'Local CLI', installed: true, reasoningOptions: [{ id: 'high', label: 'High' }] };
    const onReasoningChange = vi.fn<(agentId: string, reasoning: string) => void>();
    renderHook(() => useLocalCliAgentCard({
      agent, config: { agentId: 'local', reasoningByAgentId: { local: 'medium' } }, agentTest: { status: 'idle' },
      cliEnvFields: [], onModelChange: vi.fn(), onReasoningChange, t: (key) => key,
    }));
    expect(onReasoningChange).toHaveBeenCalledWith('local', '');
  });
});

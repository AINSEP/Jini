import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeExecutionPort } from '../../../dependencies.js';
import type { ExecutionConfig, ProviderPreset } from '../../../types.js';
import { ExecutionTab } from '../../../react/components/ExecutionTab.js';

const SYNTHETIC_API_KEY = `sk-test-${'0'.repeat(32)}`;
const CONFIG: ExecutionConfig = {
  mode: 'byok',
  byok: { protocol: 'anthropic', providerId: 'anthropic', apiKey: SYNTHETIC_API_KEY, baseUrl: 'https://api.example.com', model: 'example-model' },
  localCli: { agentId: null },
};
const PRESETS: ProviderPreset[] = [
  { id: 'anthropic', title: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.example.com', preferredModels: ['example-model'], kind: 'protocol' },
];

describe('ExecutionTab host slots and mode guard', () => {
  it('forwards the formFooter slot to the BYOK card', () => {
    render(
      <ExecutionTab config={CONFIG} onConfigChange={() => {}} port={createFakeExecutionPort()} presets={PRESETS}
        formFooter={<button type="button">Save settings</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument();
  });

  it('never switches to Local CLI while the host reports it unavailable, but still switches when it is available', async () => {
    const changes: ExecutionConfig[] = [];
    const { rerender } = render(
      <ExecutionTab config={CONFIG} onConfigChange={(next) => changes.push(next)} port={createFakeExecutionPort()} presets={PRESETS}
        localCliUnavailableReason="Not available on this deployment" />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /Local CLI/ }));
    expect(changes).toEqual([]);

    rerender(
      <ExecutionTab config={CONFIG} onConfigChange={(next) => changes.push(next)} port={createFakeExecutionPort()} presets={PRESETS} />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /Local CLI/ }));
    expect(changes.map((next) => next.mode)).toEqual(['local-cli']);
  });
});

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createLabCatalog } from '@jini-ai/agentic/a2ui';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import { A2uiSurfaceCard } from '../A2uiSurfaceCard.js';

it('validates and renders nested provider components against the same injected registry', () => {
  // DI component contribution, not a module mock: the interpreter and registry remain real.
  const registry = DEFAULT_INTERACTIVE_UI_REGISTRY.register({ entry: {
    id: 'fixture.caption', provider: 'fixture', capabilities: ['text'],
    propsSchema: z.object({ caption: z.string() }),
    Component: ({ caption }) => <output>{String(caption)}</output>,
  } });
  const events = [{ version: 'v1.0', createSurface: {
    surfaceId: 'registry-surface', catalogId: createLabCatalog({}).catalogId,
    components: [
      { id: 'root', component: 'Column', children: ['card'] },
      { id: 'card', component: 'Card', child: 'caption' },
      { id: 'caption', component: 'fixture.caption', caption: 'Injected provider rendered' },
    ],
  } }];
  const baseline = render(<A2uiSurfaceCard name="a2ui" runId="run-registry" events={events} runStreaming={false} runSucceeded />);
  expect(screen.getByRole('status')).toHaveTextContent('A2UI surface refused:');
  baseline.unmount();
  render(<A2uiSurfaceCard name="a2ui" runId="run-registry" events={events} runStreaming={false} runSucceeded registry={registry} />);
  expect(screen.getByRole('status')).toHaveTextContent('Injected provider rendered');
  expect(screen.queryByText(/A2UI surface refused:/)).toBeNull();
});

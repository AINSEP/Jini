import { screen } from '@testing-library/react';
import { renderWithChatSurfaces } from '../../__tests__/fake-chat-surfaces.js';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createLabCatalog } from '@jini-ai/protocol/a2ui';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import { A2uiSurfaceCard } from '../A2uiSurfaceCard.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };

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
  const baseline = renderWithChatSurfaces(<A2uiSurfaceCard name="a2ui" clock={testClock} runId="run-registry" events={events} runStreaming={false} runSucceeded />);
  // 13114809 added this registry seam. Valid parents survive a refused child, so the
  // existing root renders with an action-refusal notice rather than a rootless surface notice.
  expect(screen.getByRole('status')).toHaveTextContent(`Action refused: Component type "fixture.caption" is not in catalog "${createLabCatalog({}).catalogId}" — refused, not rendered.`);
  expect(screen.getByText('⚠ missing component “caption”')).toBeInTheDocument();
  baseline.unmount();
  renderWithChatSurfaces(<A2uiSurfaceCard name="a2ui" clock={testClock} runId="run-registry" events={events} runStreaming={false} runSucceeded registry={registry} />);
  expect(screen.getByRole('status')).toHaveTextContent('Injected provider rendered');
  expect(screen.queryByText(/(?:A2UI surface|Action) refused:/)).toBeNull();
  expect(screen.queryByText('⚠ missing component “caption”')).toBeNull();
});

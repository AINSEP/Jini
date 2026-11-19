import { createRef } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAgentHandle } from '@jini-ai/ui';
import { useT } from '../../../../hooks/context.js';
import { renderWithChatSurfaces } from '../../../../__tests__/fake-chat-surfaces.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane, useComposerHandlePublisher } from '../../components/ChatPane.js';
import { useChatPaneTranscriptProps } from '../../components/ChatPaneLayout.js';
import type { ChatPaneComposerHandle } from '../../types.js';
import { useChatPaneSurface } from '../../hooks/useChatPaneSurface.hooks.js';
import { useChatPaneComposerPlaceholder } from '../../hooks/useChatPaneComposerPlaceholder.hooks.js';
import { useChatPaneRuntimeInventory } from '../../hooks/useChatPaneRuntimeInventory.hooks.js';
import { useChatPane } from '../../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../../hooks/useChatPaneAgentControl.hooks.js';
import { useChatPaneFileDrop } from '../../hooks/useChatPaneFileDrop.hooks.js';
import { useChatPaneControlsHeight } from '../../hooks/useChatPaneControlsHeight.hooks.js';
import { useChatPaneSuggestion } from '../../hooks/useChatPaneSuggestion.hooks.js';
import { useChatPaneNewTabLinks } from '../../hooks/useChatPaneNewTabLinks.hooks.js';

it('calls every injected hook and preserves suggestions, measurement targets and handle cleanup', () => {
  const useAgentHandleHook: typeof useAgentHandle = vi.fn(useAgentHandle);
  const useTHook: typeof useT = vi.fn(useT);
  const useChatPaneSurfaceHook: typeof useChatPaneSurface = vi.fn(useChatPaneSurface);
  const useChatPaneComposerPlaceholderHook: typeof useChatPaneComposerPlaceholder = vi.fn(useChatPaneComposerPlaceholder);
  const useChatPaneRuntimeInventoryHook: typeof useChatPaneRuntimeInventory = vi.fn(useChatPaneRuntimeInventory);
  const useChatPaneHook: typeof useChatPane = vi.fn(useChatPane);
  const useComposerHandlePublisherHook: typeof useComposerHandlePublisher = vi.fn(useComposerHandlePublisher);
  const useChatPaneAgentControlHook: typeof useChatPaneAgentControl = vi.fn(useChatPaneAgentControl);
  const useChatPaneFileDropHook: typeof useChatPaneFileDrop = vi.fn(useChatPaneFileDrop);
  const useChatPaneControlsHeightHook: typeof useChatPaneControlsHeight = vi.fn(useChatPaneControlsHeight);
  const useChatPaneSuggestionHook: typeof useChatPaneSuggestion = vi.fn(useChatPaneSuggestion);
  const useChatPaneNewTabLinksHook: typeof useChatPaneNewTabLinks = vi.fn(useChatPaneNewTabLinks);
  const useChatPaneTranscriptPropsHook: typeof useChatPaneTranscriptProps = vi.fn(useChatPaneTranscriptProps);
  let measured: ReturnType<typeof useChatPaneControlsHeight> | undefined;
  const measure: typeof useChatPaneControlsHeight = () => {
    measured = useChatPaneControlsHeightHook();
    return measured;
  };
  const composerHandle = createRef<ChatPaneComposerHandle>();
  const view = renderWithChatSurfaces(<ChatPane transport={createFakeChatTransport()}
    agents={[{ id: 'codex', name: 'Codex', available: true }]} suggestions={['Inspect the workspace']}
    composerHandle={composerHandle}
    useAgentHandleHook={useAgentHandleHook}
    useTHook={useTHook}
    useChatPaneSurfaceHook={useChatPaneSurfaceHook}
    useChatPaneComposerPlaceholderHook={useChatPaneComposerPlaceholderHook}
    useChatPaneRuntimeInventoryHook={useChatPaneRuntimeInventoryHook}
    useChatPaneHook={useChatPaneHook}
    useComposerHandlePublisherHook={useComposerHandlePublisherHook}
    useChatPaneAgentControlHook={useChatPaneAgentControlHook}
    useChatPaneFileDropHook={useChatPaneFileDropHook}
    useChatPaneControlsHeightHook={measure}
    useChatPaneSuggestionHook={useChatPaneSuggestionHook}
    useChatPaneNewTabLinksHook={useChatPaneNewTabLinksHook}
    useChatPaneTranscriptPropsHook={useChatPaneTranscriptPropsHook}
  />);
  expect(useAgentHandleHook).toHaveBeenCalled();
  expect(useTHook).toHaveBeenCalled();
  expect(useChatPaneSurfaceHook).toHaveBeenCalled();
  expect(useChatPaneComposerPlaceholderHook).toHaveBeenCalled();
  expect(useChatPaneRuntimeInventoryHook).toHaveBeenCalled();
  expect(useChatPaneHook).toHaveBeenCalled();
  expect(useComposerHandlePublisherHook).toHaveBeenCalled();
  expect(useChatPaneAgentControlHook).toHaveBeenCalled();
  expect(useChatPaneFileDropHook).toHaveBeenCalled();
  expect(useChatPaneControlsHeightHook).toHaveBeenCalled();
  expect(useChatPaneSuggestionHook).toHaveBeenCalled();
  expect(useChatPaneNewTabLinksHook).toHaveBeenCalled();
  expect(useChatPaneTranscriptPropsHook).toHaveBeenCalled();
  expect(measured!.rootRef.current).toBe(view.container.querySelector('section.jini-chat-pane'));
  expect(measured!.controlsRef.current).toBe(view.container.querySelector('.jini-chat-pane__controls'));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect the workspace' }));
  expect(screen.getByRole('textbox')).toHaveValue('Inspect the workspace');
  expect(screen.getByRole('textbox')).toHaveFocus();
  expect(composerHandle.current).not.toBeNull();
  view.unmount();
  expect(composerHandle.current).toBeNull();
});

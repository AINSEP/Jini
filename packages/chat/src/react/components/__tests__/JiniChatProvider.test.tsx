import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JiniChatProvider, useJiniChatSlots, useOnFeedback } from '../JiniChatProvider.js';
import { useT, useProjectContext, useAnalytics, useChatTransport, useArtifactRegistry } from '../../hooks/context.js';
import { createFakeChatTransport } from '../../hooks/testing/fake-transport.js';
import { RendererRegistry } from '../../artifact-types.js';

function Probe() {
  const t = useT();
  const project = useProjectContext();
  const analytics = useAnalytics();
  const transport = useChatTransport();
  const registry = useArtifactRegistry();
  const slots = useJiniChatSlots();
  const onFeedback = useOnFeedback();
  return (
    <div>
      <span data-testid="t">{t('Hello')}</span>
      <span data-testid="project">{project?.projectId ?? 'none'}</span>
      <span data-testid="has-transport">{transport ? 'yes' : 'no'}</span>
      <span data-testid="has-registry">{registry ? 'yes' : 'no'}</span>
      <span data-testid="has-model-picker-slot">{slots.modelPicker ? 'yes' : 'no'}</span>
      <span data-testid="has-feedback">{onFeedback ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => analytics.track('probe_clicked')}>
        track
      </button>
    </div>
  );
}

describe('JiniChatProvider', () => {
  it('wires transport/project/i18n/analytics/artifactRegistry/slots/onFeedback into context', () => {
    const transport = createFakeChatTransport();
    const registry = new RendererRegistry();
    render(
      <JiniChatProvider
        transport={transport}
        project={{ projectId: 'proj-1', files: [], resolveFileUrl: (p) => p, resolveRawUrl: (p) => p }}
        i18n={{ locale: 'en', t: (key) => `[${key}]` }}
        analytics={{ track: () => {} }}
        artifactRegistry={registry}
        slots={{ modelPicker: { value: { agentId: 'claude' }, onChange: () => {} } }}
        onFeedback={() => {}}
      >
        <Probe />
      </JiniChatProvider>,
    );
    expect(screen.getByTestId('t')).toHaveTextContent('[Hello]');
    expect(screen.getByTestId('project')).toHaveTextContent('proj-1');
    expect(screen.getByTestId('has-transport')).toHaveTextContent('yes');
    expect(screen.getByTestId('has-registry')).toHaveTextContent('yes');
    expect(screen.getByTestId('has-model-picker-slot')).toHaveTextContent('yes');
    expect(screen.getByTestId('has-feedback')).toHaveTextContent('yes');
  });

  it('falls back to passthrough i18n and undefined project/slots when omitted', () => {
    const transport = createFakeChatTransport();
    render(
      <JiniChatProvider transport={transport}>
        <Probe />
      </JiniChatProvider>,
    );
    expect(screen.getByTestId('t')).toHaveTextContent('Hello');
    expect(screen.getByTestId('project')).toHaveTextContent('none');
    expect(screen.getByTestId('has-model-picker-slot')).toHaveTextContent('no');
  });

  it('useChatTransport() throws outside a provider', () => {
    function Bare() {
      useChatTransport();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/JiniChatProvider/);
  });
});

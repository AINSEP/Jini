import { useLayoutEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { A2uiSurfaceRenderer } from '../renderer.js';
import { useA2uiSurfaceRoot } from '../use-a2ui-surface.js';
import { createA2uiInterpreter, createLabCatalog } from '../protocol.js';
import { InteractiveUiRegistry } from '../../interactive-ui/registry.js';

function fixture() {
  const catalog = createLabCatalog({});
  const interpreter = createA2uiInterpreter({ catalog, clock: { nowMs: () => 1_000 }, ids: { next: () => 'action-id' } });
  interpreter.applyAgentMessage({ raw: {
    version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: catalog.catalogId,
      dataModel: { user: { name: 'Ada' } }, components: [
        { id: 'root', component: 'Column', children: ['label'] },
        { id: 'label', component: 'Text', text: { path: '/user/name' } },
      ],
    },
  } });
  const registry = new InteractiveUiRegistry({ entries: [] });
  return { interpreter, registry, catalog };
}

describe('surface updates with an unchanged root', () => {
  it('renders a changed descendant without replacing the root', () => {
    const { interpreter, registry } = fixture();
    const root = interpreter.getRoot({ surfaceId: 's1' });
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="s1" registry={registry} />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    act(() => {
      interpreter.applyAgentMessage({ raw: { version: 'v1.0', updateComponents: {
        surfaceId: 's1', components: [{ id: 'label', component: 'Text', text: 'Grace' }],
      } } });
    });
    expect(interpreter.getRoot({ surfaceId: 's1' })).toBe(root);
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('renders updated bound data without replacing any component', () => {
    const { interpreter, registry } = fixture();
    const root = interpreter.getRoot({ surfaceId: 's1' });
    const label = interpreter.getSurface({ surfaceId: 's1' })?.components.get('label');
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="s1" registry={registry} />);
    act(() => {
      interpreter.applyAgentMessage({ raw: { version: 'v1.0', updateDataModel: { surfaceId: 's1', path: '/user/name', value: 'Grace' } } });
    });
    expect(interpreter.getRoot({ surfaceId: 's1' })).toBe(root);
    expect(interpreter.getSurface({ surfaceId: 's1' })?.components.get('label')).toBe(label);
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('does not rerender an unchanged surface on unrelated notifications', () => {
    const { interpreter, catalog } = fixture();
    let renders = 0;
    function Probe() {
      useA2uiSurfaceRoot({ interpreter, surfaceId: 's1' });
      renders += 1;
      return null;
    }
    render(<Probe />);
    const before = renders;
    act(() => {
      interpreter.applyAgentMessage({ raw: { version: 'v1.0', createSurface: { surfaceId: 'other', catalogId: catalog.catalogId } } });
    });
    expect(renders).toBe(before);
  });

  it('sees a descendant update between rendering and subscription', () => {
    const { interpreter, registry } = fixture();
    function UpdateBeforeSubscribe() {
      useLayoutEffect(() => {
        interpreter.applyAgentMessage({ raw: { version: 'v1.0', updateComponents: {
          surfaceId: 's1', components: [{ id: 'label', component: 'Text', text: 'Grace' }],
        } } });
      }, []);
      return null;
    }
    render(<><A2uiSurfaceRenderer interpreter={interpreter} surfaceId="s1" registry={registry} /><UpdateBeforeSubscribe /></>);
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  it('shows the fallback after deletion and follows a new surface id', () => {
    const { interpreter, registry, catalog } = fixture();
    const { rerender } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="s1" registry={registry} fallback="Waiting" />);
    act(() => { interpreter.applyAgentMessage({ raw: { version: 'v1.0', deleteSurface: { surfaceId: 's1' } } }); });
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    act(() => { interpreter.applyAgentMessage({ raw: { version: 'v1.0', createSurface: {
      surfaceId: 's2', catalogId: catalog.catalogId, components: [{ id: 'root', component: 'Text', text: 'Second' }],
    } } }); });
    rerender(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="s2" registry={registry} fallback="Waiting" />);
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostEditorTemplateModalGate, type PostEditorTemplateModalGateProps, type PostEditorTemplateSourceModalProps } from '../editor/template/PostEditorTemplateModalGate.js';

const t = (text: string) => `~${text}`;

function renderGate(overrides: Partial<PostEditorTemplateModalGateProps<'static'>> = {}) {
  const seen: Array<PostEditorTemplateSourceModalProps<'static'>> = [];
  const TemplateSourceModal = (props: PostEditorTemplateSourceModalProps<'static'>) => { seen.push(props); return <div data-testid="modal" />; };
  const props: PostEditorTemplateModalGateProps<'static'> = {
    show: true, templateChoice: 'post.html', activeThemeId: 'theme-a', activeThemeTier: 'static', activeThemeApiVersion: 2,
    onClose: vi.fn(), confirmLeave: vi.fn(() => true), t, TemplateSourceModal, ...overrides,
  };
  return { seen, props, ...render(<PostEditorTemplateModalGate {...props} />) };
}

describe('PostEditorTemplateModalGate', () => {
  it('mounts the injected modal with the active theme, template and the post edit handle', () => {
    const { seen, props, getByTestId } = renderGate();
    expect(getByTestId('modal')).toBeTruthy();
    expect(seen[0]).toEqual({
      themeId: 'theme-a', themeTier: 'static', themeApiVersion: 2, templateFilename: 'post.html',
      onClose: props.onClose, confirmLeave: props.confirmLeave, t, editAgentHandleId: 'post-template-edit',
    });
  });

  it.each([
    ['hidden', { show: false }],
    ['no template chosen', { templateChoice: '' }],
    ['no template choice', { templateChoice: null }],
    ['no active theme', { activeThemeId: null }],
  ])('renders nothing when %s', (_label, overrides) => {
    const { seen, container } = renderGate(overrides);
    expect(container.innerHTML).toBe('');
    expect(seen).toEqual([]);
  });
});

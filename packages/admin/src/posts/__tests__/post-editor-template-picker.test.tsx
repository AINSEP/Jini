// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PostEditorTemplatePicker,
  type PostEditorViewTemplateButtonProps,
} from '../editor/template/PostEditorTemplatePicker.js';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

function FakeViewTemplateButton({ disabled, onClick, agentHandleId }: PostEditorViewTemplateButtonProps) {
  return <button type="button" data-fake-view={agentHandleId} disabled={disabled} onClick={onClick}>view</button>;
}

function renderPicker(overrides: Partial<Parameters<typeof PostEditorTemplatePicker>[0]> = {}) {
  const props = {
    bodyFormat: 'doc' as const, availableTemplates: ['post', 'wide'], templateChoice: 'post',
    setTemplateChoice: vi.fn(), onViewTemplateClick: vi.fn(), ViewTemplateButton: FakeViewTemplateButton, t,
    ...overrides,
  };
  return { props, ...render(<PostEditorTemplatePicker {...props} />) };
}

describe('PostEditorTemplatePicker', () => {
  it('renders nothing for an html-format record', () => {
    const { container } = renderPicker({ bodyFormat: 'html' });
    expect(container.innerHTML).toBe('');
  });

  it('treats a missing bodyFormat as doc', () => {
    const { container } = renderPicker({ bodyFormat: undefined });
    expect(container.querySelector('.jini-editor-template-picker')).not.toBeNull();
  });

  it('lists templates first and "No template chosen" last, and persists the raw value', () => {
    const { props } = renderPicker();
    const select = screen.getByLabelText('~Template') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([
      ['post', 'post'], ['wide', 'wide'], ['', '~No template chosen'],
    ]);
    fireEvent.change(select, { target: { value: '' } });
    expect(props.setTemplateChoice).toHaveBeenCalledWith('');
  });

  it('wires the injected view button: enabled with a choice, disabled without', () => {
    const { props, rerender } = renderPicker();
    const button = document.querySelector('[data-fake-view="post-view-template"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(props.onViewTemplateClick).toHaveBeenCalledTimes(1);
    rerender(<PostEditorTemplatePicker {...props} templateChoice="" />);
    expect((document.querySelector('[data-fake-view]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a disabled explanation select when the theme declares no templates', () => {
    const { container } = renderPicker({ availableTemplates: [] });
    const select = container.querySelector('.jini-editor-template-picker select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options[0]?.text).toBe('~No templates for this theme');
    expect(container.querySelector('[data-fake-view]')).toBeNull();
  });
});

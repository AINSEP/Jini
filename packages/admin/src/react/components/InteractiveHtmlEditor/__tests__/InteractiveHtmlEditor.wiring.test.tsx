import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { InteractiveHtmlEditorProps as HtmlEditorProps } from '@jini-ai/ui/html-editor';
import { InteractiveHtmlEditor } from '../InteractiveHtmlEditor.js';

// The generic editor mounts GrapesJS; a recording fake proves only what this composition passes it.
const received: HtmlEditorProps[] = [];
vi.mock('@jini-ai/ui/html-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@jini-ai/ui/html-editor')>()),
  InteractiveHtmlEditor: (props: HtmlEditorProps) => { received.push(props); return null; },
}));

it('forwards host props and wires the embed-marker protection and placeholder descriptions', () => {
  const onChange = vi.fn();
  render(<InteractiveHtmlEditor html="<p>x</p>" onChange={onChange} className="page-editor" />);
  const props = received.at(-1)!;
  expect(props.html).toBe('<p>x</p>');
  expect(props.onChange).toBe(onChange);
  expect(props.className).toBe('page-editor');
  const marker = document.createElement('div');
  marker.setAttribute('data-embed-type', 'media');
  marker.setAttribute('data-embed-config', '{"type":"media","id":"m1"}');
  expect(props.isProtectedElement?.(marker)).toBe(true);
  expect(props.isProtectedElement?.(document.createElement('p'))).toBe(false);
  expect(props.describeEmbedPlaceholder?.(marker)).toEqual({ kindLabel: 'Media', identityLabel: 'id m1' });
});

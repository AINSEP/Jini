import { render, testAdminKit } from '../../../../__tests__/fetch-query-support.js';
import { expect, it, vi } from 'vitest';
import { AdminKitProvider, type HtmlEditorProps } from '../../../kit.js';
import { InteractiveHtmlEditor } from '../InteractiveHtmlEditor.js';

// A recording fake of the kit's HtmlEditor slot proves only what this composition passes it.
const received: HtmlEditorProps[] = [];
const recordingKit = { ...testAdminKit, components: { ...testAdminKit.components, HtmlEditor: (props: HtmlEditorProps) => { received.push(props); return null; } } };

it('forwards host props and wires the embed-marker protection and placeholder descriptions', () => {
  const onChange = vi.fn();
  render(<AdminKitProvider kit={recordingKit}><InteractiveHtmlEditor html="<p>x</p>" onChange={onChange} className="page-editor" /></AdminKitProvider>);
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

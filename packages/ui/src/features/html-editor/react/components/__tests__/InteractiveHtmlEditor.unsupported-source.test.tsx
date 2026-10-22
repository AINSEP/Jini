import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InteractiveHtmlEditor } from '../InteractiveHtmlEditor.js';
import { EditorSourceError } from '../../../protected-elements.js';

/**
 * @file A source the visual editor cannot own (here: an unterminated raw `<script>`) must fail closed
 * before GrapesJS is ever initialized: the editor shows the integrity message in place and reports it,
 * rather than mounting a canvas that would rewrite the source on save.
 */
const UNSUPPORTED = '<script>x()';

describe('InteractiveHtmlEditor on a source it cannot edit visually', () => {
  it('shows the integrity message as an alert and reports it to the host', () => {
    const onSerializationError = vi.fn();
    const onChange = vi.fn();
    const { container } = render(<InteractiveHtmlEditor html={UNSUPPORTED} onChange={onChange} onSerializationError={onSerializationError} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Can't edit this source visually. Use HTML.");
    expect(onSerializationError).toHaveBeenCalledTimes(1);
    expect(onSerializationError.mock.calls[0]![0]).toBeInstanceOf(EditorSourceError);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.firstElementChild).toHaveAttribute('class', 'interactive-html-editor');
  });

  it('words the message through the host translator and keeps the host class beside the base class', () => {
    const translate = (text: string) => `[es] ${text}`;
    const { container } = render(<InteractiveHtmlEditor html={UNSUPPORTED} onChange={() => {}} translate={translate} className="host-editor" />);
    expect(screen.getByRole('alert')).toHaveTextContent("[es] Can't edit this source visually. Use HTML.");
    expect(container.firstElementChild).toHaveClass('interactive-html-editor', 'host-editor');
  });
});

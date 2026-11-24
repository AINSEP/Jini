// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolbarCharacterCount } from '../editor/toolbar/ToolbarCharacterCount.js';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

describe('ToolbarCharacterCount', () => {
  it.each([
    [0, '0 ~characters'],
    [1, '1 ~character'],
    [2, '2 ~characters'],
  ])('reads %i as "%s" in a polite live region with the jini class', (characterCount, text) => {
    const { container } = render(<ToolbarCharacterCount state={{ characterCount }} t={t} />);
    const span = container.querySelector('span.jini-post-toolbar__count');
    expect(span?.textContent).toBe(text);
    expect(span?.getAttribute('aria-live')).toBe('polite');
  });
});

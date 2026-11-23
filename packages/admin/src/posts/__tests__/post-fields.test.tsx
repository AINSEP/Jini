// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostAuthorFields } from '../PostAuthorFields.js';
import { PostPublishAtField } from '../PostPublishingFields.js';
import { agentHandle } from '@jini-ai/core/agent-handles';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

describe('PostAuthorFields', () => {
  it('labels both byline controls with the jini-field-label class through the injected t', () => {
    render(<PostAuthorFields author="Ada" setAuthor={vi.fn()} showAuthor={false} setShowAuthor={vi.fn()} t={t} agentHandle={agentHandle} />);
    for (const label of ['~Author', '~Show post author']) {
      expect(screen.getByText(label).className).toBe('jini-field-label');
    }
  });

  it('hands edits to the injected setters', () => {
    const setAuthor = vi.fn();
    const setShowAuthor = vi.fn();
    render(<PostAuthorFields author="Ada" setAuthor={setAuthor} showAuthor={false} setShowAuthor={setShowAuthor} t={t} agentHandle={agentHandle} />);
    fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Grace' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(setAuthor).toHaveBeenCalledWith('Grace');
    expect(setShowAuthor).toHaveBeenCalledWith(true);
  });
});

describe('PostPublishAtField', () => {
  it('labels the control with the jini-field-label class and hands edits to the injected setter', () => {
    const setPublishAtInput = vi.fn();
    const { container } = render(<PostPublishAtField publishAtInput="" setPublishAtInput={setPublishAtInput} scheduled={false} t={t} agentHandle={agentHandle} />);
    expect(screen.getByText('~Publish at').className).toBe('jini-field-label');
    fireEvent.change(container.querySelector('input[type="datetime-local"]')!, { target: { value: '2026-12-01T09:30' } });
    expect(setPublishAtInput).toHaveBeenCalledWith('2026-12-01T09:30');
  });
});

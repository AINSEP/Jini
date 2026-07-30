// Separate file because it mocks `mention-node.js`'s `$createMentionNode`
// to throw, module-wide, in order to force a real internal Lexical error
// through `RichTextInput`'s `onError` — scoping that mock to its own file
// keeps every other RichTextInput test using the real implementation.
import { render } from '@testing-library/react';
import { act, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MentionEntity, RichTextInputHandle } from '../../types.js';
import { RichTextInput, type RichTextInputProps } from './RichTextInput.js';

vi.mock('../../mention-node.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mention-node.js')>();
  return {
    ...actual,
    $createMentionNode: () => {
      throw new Error('boom');
    },
  };
});

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' };

function baseProps(overrides: Partial<RichTextInputProps> = {}): RichTextInputProps {
  return {
    placeholder: 'Type a message',
    value: '',
    knownMentions: [],
    onChange: vi.fn(),
    onTriggerChange: vi.fn(),
    onSubmit: vi.fn(),
    popoverOpen: false,
    onPopoverKey: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('RichTextInput onError', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs to console.error outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ref = createRef<RichTextInputHandle>();
    render(<RichTextInput {...baseProps({ knownMentions: [slack] })} ref={ref} />);
    act(() => {
      ref.current!.insertMention({ token: '@Slack', entity: slack });
    });
    expect(errorSpy).toHaveBeenCalledWith('[rich-text-input]', expect.any(Error));
  });

  it('does not log to console.error in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ref = createRef<RichTextInputHandle>();
    render(<RichTextInput {...baseProps({ knownMentions: [slack] })} ref={ref} />);
    act(() => {
      ref.current!.insertMention({ token: '@Slack', entity: slack });
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SECRET_REDACTED_NOTICE, type RedactUserText } from '../../../../../core/user-text-redaction.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane } from '../../components/ChatPane.js';
import type { ChatPaneAgent } from '../../types.js';

const agents: ChatPaneAgent[] = [{ id: 'codex', name: 'Codex CLI', available: true }];

describe('ChatPane secret redaction notice', () => {
  it('sends only the redacted text and tells the person a key was removed', async () => {
    const transport = createFakeChatTransport();
    // A host policy fake: whatever follows "key:" counts as a credential. No real secret shape needed.
    const redactUserText: RedactUserText = ({ text }) => {
      const redacted = text.replace(/key:\S+/u, 'key:[removed]');
      return { text: redacted, secretRedacted: redacted !== text, count: redacted === text ? 0 : 1 };
    };
    const onSecretRedacted = vi.fn();
    render(<ChatPane transport={transport} agents={agents} redactUserText={redactUserText} onSecretRedacted={onSecretRedacted} />);
    expect(screen.queryByText(SECRET_REDACTED_NOTICE)).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: `deploy with key:${'x'.repeat(8)}` } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    await waitFor(() => expect(transport.calls).toHaveLength(1));
    expect(transport.calls[0]?.input.history.at(-1)?.content).toBe('deploy with key:[removed]');
    expect(await screen.findByText(SECRET_REDACTED_NOTICE)).toHaveAttribute('role', 'status');
    expect(onSecretRedacted).toHaveBeenCalledWith({ secretRedacted: true, count: 1 });
    act(() => transport.finish([]));
  });
});

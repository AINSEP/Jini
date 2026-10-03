import { describe, expect, test } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createVibecodingSession } from '../../session.js';
import { VibecodingWorkbench } from '../../components/VibecodingWorkbench.js';
import type { EditTarget } from '../../../core/target.js';
import type { PartId, Snapshot } from '../../../core/types.js';

function makeTarget(initial: Record<PartId, string> = {}): EditTarget {
  const parts = new Map<PartId, string>(Object.entries(initial));
  return {
    listParts: async () => [...parts.keys()].map((id) => ({ id })),
    readPart: async ({ id }) => {
      const found = parts.get(id);
      if (found === undefined) throw new Error(`no such part: ${id}`);
      return found;
    },
    replacePart: async ({ id, content }) => {
      parts.set(id, content);
    },
    snapshot: async (): Promise<Snapshot> => ({ id: 'snap', parts: Object.fromEntries(parts) }),
    restore: async ({ snapshot }) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async () => ({ ok: true }),
  };
}

describe('VibecodingWorkbench', () => {
  test('lists parts from the session and previews the selected one\'s content', async () => {
    const session = createVibecodingSession({ target: makeTarget({ hero: '<h1>Hero</h1>' }) });
    const user = userEvent.setup();
    const { container } = render(<VibecodingWorkbench session={session} />);

    await waitFor(() => expect(screen.getByText('hero')).toBeInTheDocument());
    await user.click(screen.getByText('hero'));

    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('srcdoc')).toBe('<h1>Hero</h1>');
    });
  });

  test('prefers host-supplied documentHtml over the selected part\'s own content', async () => {
    const session = createVibecodingSession({ target: makeTarget({ hero: '<h1>Hero</h1>' }) });
    const { container } = render(
      <VibecodingWorkbench session={session} documentHtml="<html>whole document</html>" />,
    );

    await waitFor(() => {
      expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<html>whole document</html>');
    });
  });

  test('undo is disabled until an edit lands, then reverts it', async () => {
    const session = createVibecodingSession({ target: makeTarget({ hero: 'old' }) });
    const user = userEvent.setup();
    render(<VibecodingWorkbench session={session} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled());

    await session.applyEdits({ edits: [{ id: 'hero', content: 'new' }] });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(async () => expect(await session.readPart({ id: 'hero' })).toBe('old'));
  });

  test('surfaces the session\'s lastError', async () => {
    const session = createVibecodingSession({ target: makeTarget() });
    render(<VibecodingWorkbench session={session} />);

    await expect(session.readPart({ id: 'missing' })).rejects.toThrow();

    await waitFor(() => expect(screen.getByText(/no such part: missing/)).toBeInTheDocument());
  });

  test('the selected preview follows edits, undo and redo without selecting the part again', async () => {
    const session = createVibecodingSession({ target: makeTarget({ hero: '<p>old</p>' }) });
    const user = userEvent.setup();
    const { container } = render(<VibecodingWorkbench session={session} />);
    await user.click(await screen.findByText('hero'));
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>old</p>'));

    await act(async () => {
      await session.applyEdits({ edits: [{ id: 'hero', content: '<p>new</p>' }] });
    });
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>new</p>'));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>old</p>'));
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>new</p>'));
  });
});

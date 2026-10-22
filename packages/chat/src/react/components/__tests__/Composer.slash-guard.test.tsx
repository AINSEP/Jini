import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';

vi.mock('../composer-discovery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../composer-discovery.js')>()),
  resolveComposerSlashInvocation: () => null,
}));

function Harness({ onDiscoverySelect }: { onDiscoverySelect: () => void }) {
  const composer = useComposer();
  return <Composer composer={composer} onSend={() => {}} slots={{ onDiscoverySelect, discoveryGroups: [{ id: 'g', label: 'G', items: [{ id: 'a', label: 'Alpha', kind: 'skill', insertText: 'alpha' }] }] }} />;
}

it('a slash pick that resolves to nothing leaves the draft and the host alone', () => {
  const onDiscoverySelect = vi.fn();
  render(<Harness onDiscoverySelect={onDiscoverySelect} />);
  const textarea = screen.getByRole('textbox');
  fireEvent.change(textarea, { target: { value: '/al' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea).toHaveValue('/al');
  expect(onDiscoverySelect).not.toHaveBeenCalled();
});

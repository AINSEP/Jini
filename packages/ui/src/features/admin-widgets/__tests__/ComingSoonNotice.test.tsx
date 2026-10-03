import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComingSoonNotice } from '../components/ComingSoonNotice.js';
describe('ComingSoonNotice', () => {
  it('renders caller copy and an optional second line', () => {
    const { rerender } = render(<ComingSoonNotice kicker="Tools" label="Reports" description="Rapports bientôt disponibles." note="Preview" agentHandle="reports-notice" />);
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText('Rapports bientôt disponibles.')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-element="reports-notice"]')).toBeInTheDocument();
    rerender(<ComingSoonNotice kicker="Tools" label="Reports" description="Coming soon." />);
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
    expect(document.querySelector('[data-agent-element]')).toBeNull();
  });
});

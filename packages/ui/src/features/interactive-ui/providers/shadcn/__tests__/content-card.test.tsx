import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentCard } from '../content-card.js';

describe('shadcn ContentCard', () => {
  it('renders title, description, and content via the real shadcn Card primitives', () => {
    const { container } = render(<ContentCard title="Plan" description="Monthly" content="$10/mo" />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('$10/mo')).toBeInTheDocument();
    expect(container.querySelector('.rounded-xl')).not.toBeNull();
  });

  it('omits the header block entirely when neither title nor description is given', () => {
    const { container } = render(<ContentCard content="Just body text" />);
    expect(container.querySelector('.flex-col')).toBeNull();
    expect(screen.getByText('Just body text')).toBeInTheDocument();
  });

  it('renders only a title without a description', () => {
    render(<ContentCard title="Plan only" />);
    expect(screen.getByText('Plan only')).toBeInTheDocument();
  });

  it('renders nothing extra when every field is omitted', () => {
    const { container } = render(<ContentCard />);
    expect(container.querySelector('.rounded-xl')).not.toBeNull();
    expect(container.textContent).toBe('');
  });
});

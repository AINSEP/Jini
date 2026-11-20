// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CenteredLoader, DesignCardSkeleton, Skeleton, Spinner } from '../../components/Loading.js';

describe('Loading primitives', () => {
  it('Spinner shows an optional label with status role', () => {
    render(<Spinner label="Loading files" />);
    expect(screen.getByRole('status').textContent).toBe('Loading files');
  });

  it('Skeleton applies width/height/radius as inline styles', () => {
    const { container } = render(<Skeleton width={100} height={20} radius={4} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('20px');
    expect(el.style.borderRadius).toBe('4px');
  });

  it('DesignCardSkeleton renders its thumb and meta rows', () => {
    const { container } = render(<DesignCardSkeleton />);
    expect(container.querySelector('.jini-design-card-thumb')).toBeTruthy();
    expect(container.querySelectorAll('.skeleton-block').length).toBe(2);
  });

  it('CenteredLoader renders a spinner and optional label', () => {
    render(<CenteredLoader label="Bootstrapping" />);
    expect(screen.getByText('Bootstrapping')).toBeTruthy();
  });

  it('Skeleton appends a custom className', () => {
    const { container } = render(<Skeleton className="my-skel" />);
    expect((container.firstChild as HTMLElement).className).toBe('skeleton-block my-skel');
  });

  it('CenteredLoader omits the label span when no label is given', () => {
    const { container } = render(<CenteredLoader />);
    expect(container.querySelector('.jini-centered-loader-label')).toBeNull();
  });
});

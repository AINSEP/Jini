import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectorLogo } from '../../components/ConnectorLogo.js';

describe('ConnectorLogo', () => {
  it('renders an initials fallback when no logoUrl is given', () => {
    const { container } = render(<ConnectorLogo connectorId="slack" connectorName="Slack" />);
    expect(container.querySelector('.jini-connector-logo-fallback')?.textContent).toBe('Sl');
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders an image when a logoUrl is given, falling back to initials on error', () => {
    const { container } = render(<ConnectorLogo connectorId="slack" connectorName="Slack" logoUrl="https://example.com/slack.png" />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('.jini-ui-connector-logo')?.className).toContain('is-fallback');
  });

  it('is decorative (aria-hidden) since the caption is the accessible label elsewhere', () => {
    render(<ConnectorLogo connectorId="slack" connectorName="Slack" />);
    expect(screen.getByText('Sl').closest('[aria-hidden]')).toBeTruthy();
  });

  it('shows the image once it loads successfully', () => {
    const { container } = render(<ConnectorLogo connectorId="slack" connectorName="Slack" logoUrl="https://example.com/slack.png" />);
    const img = container.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('.jini-ui-connector-logo')?.className).toContain('state-loaded');
    expect(container.querySelector('.jini-ui-connector-logo')?.className).not.toContain('is-fallback');
  });

  it('detects an already-complete, successfully-loaded image synchronously on mount', () => {
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 32 });
    try {
      const { container } = render(
        <ConnectorLogo connectorId="slack" connectorName="Slack" logoUrl="https://example.com/slack.png" />,
      );
      expect(container.querySelector('.jini-ui-connector-logo')?.className).toContain('state-loaded');
    } finally {
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
    }
  });

  it('detects an already-complete but zero-width (broken) image synchronously on mount', () => {
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 0 });
    try {
      const { container } = render(
        <ConnectorLogo connectorId="slack" connectorName="Slack" logoUrl="https://example.com/slack.png" />,
      );
      expect(container.querySelector('.jini-ui-connector-logo')?.className).toContain('is-fallback');
    } finally {
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
    }
  });

  it('falls back to connectorName for the palette seed when connectorId is empty', () => {
    const { container: withId } = render(<ConnectorLogo connectorId="slack" connectorName="Zzz" />);
    const { container: withoutId } = render(<ConnectorLogo connectorId="" connectorName="Slack" />);
    // Same seed string ('slack'/'Slack' case-insensitively hash differently
    // in general, so instead just prove the empty-id path doesn't throw and
    // produces *some* palette index, and that the fallback truly used
    // connectorName rather than an empty string (which would still produce
    // a deterministic index, so directly compare against a real
    // connectorId="Slack" render to prove they match).
    const { container: viaIdSlack } = render(<ConnectorLogo connectorId="Slack" connectorName="unused" />);
    expect(withoutId.querySelector('.jini-ui-connector-logo')?.getAttribute('data-palette')).toBe(
      viaIdSlack.querySelector('.jini-ui-connector-logo')?.getAttribute('data-palette'),
    );
    expect(withId.querySelector('.jini-ui-connector-logo')?.getAttribute('data-palette')).not.toBeNull();
  });

  it('renders the lg size variant', () => {
    const { container } = render(<ConnectorLogo connectorId="slack" connectorName="Slack" size="lg" />);
    expect(container.querySelector('.jini-ui-connector-logo')?.className).toContain('size-lg');
  });
});

// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentIcon } from '../../components/AgentIcon.js';

describe('AgentIcon', () => {
  it('renders an img with its own bundled data-URI icon for a known svg-family id', () => {
    const { container } = render(<AgentIcon id="claude" size={24} />);
    const img = container.querySelector('img');
    const src = img?.getAttribute('src');
    // A literal `data:` URI, not a path — see `AgentIcon.tsx`'s `BUNDLED_ICON_URLS` doc for why a
    // `basePath`-relative or `new URL(..., import.meta.url)` path is exactly the fragile shape
    // this replaced (both resolve differently per bundler/runtime, including under Vitest+jsdom —
    // this file's own `import.meta.url` resolves to an `http://` URL here, not `file://`, which is
    // why the comparison path below is built from `process.cwd()` instead).
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(src!.slice(src!.indexOf(',') + 1), 'base64').toString('utf8');
    const sourceSvgPath = join(process.cwd(), 'src/react/components/agent-icons/claude.svg');
    expect(decoded).toBe(readFileSync(sourceSvgPath, 'utf8'));
    expect(img?.getAttribute('width')).toBe('24');
  });

  it('honors a custom basePath', () => {
    const { container } = render(<AgentIcon id="devin" basePath="/assets/agents" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/agents/devin.png');
  });

  it('renders a mask-based span for mono icons', () => {
    const { container } = render(<AgentIcon id="opencode" />);
    const span = container.querySelector('span.agent-icon-mono');
    expect(span).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to an initial-letter badge for unknown ids', () => {
    const { getByText } = render(<AgentIcon id="some-new-agent" />);
    expect(getByText('S')).toBeTruthy();
  });

  it('appends a custom className to the rendered mark', () => {
    const { container } = render(<AgentIcon id="claude" className="pinned" />);
    expect(container.querySelector('img')?.getAttribute('class')).toBe('agent-icon pinned');
  });

  it('uses a "?" placeholder for an id with no letters', () => {
    const { getByText } = render(<AgentIcon id="123-456" />);
    expect(getByText('?')).toBeTruthy();
  });
});

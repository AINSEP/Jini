import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';

import { DocumentPreview } from '../../components/DocumentPreview.js';

describe('DocumentPreview', () => {
  test('renders an iframe with the given html as srcDoc', () => {
    const { container } = render(<DocumentPreview html="<h1>Hi</h1>" />);

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('srcdoc')).toBe('<h1>Hi</h1>');
  });

  test('sandboxes with allow-scripts only — never allow-same-origin alongside it', () => {
    const { container } = render(<DocumentPreview html="<script>alert(1)</script>" />);

    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  test('uses a default title when none is given, and a custom one when supplied', () => {
    const { container, rerender } = render(<DocumentPreview html="" />);
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe('Live preview');

    rerender(<DocumentPreview html="" title="Hero preview" />);
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe('Hero preview');
  });
});

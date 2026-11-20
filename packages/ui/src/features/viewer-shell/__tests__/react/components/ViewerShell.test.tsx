import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewerShell, ViewerEmptyState } from '../../../react/components/ViewerShell.js';

describe('ViewerShell', () => {
  it('renders toolbar-left, toolbar-actions, and body content', () => {
    render(
      <ViewerShell kindClassName="image-viewer" bodyClassName="image-body" toolbarLeft={<span>meta</span>} toolbarActions={<button>Download</button>}>
        <div>body content</div>
      </ViewerShell>,
    );
    expect(screen.getByText('meta')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('applies the kind and body modifier classes', () => {
    const { container } = render(
      <ViewerShell kindClassName="text-viewer" bodyClassName="text-body">
        <div>x</div>
      </ViewerShell>,
    );
    expect(container.querySelector('.viewer.text-viewer')).not.toBeNull();
    expect(container.querySelector('.viewer-body.text-body')).not.toBeNull();
  });

  it('omits the toolbar-actions wrapper when no actions are given', () => {
    const { container } = render(
      <ViewerShell toolbarLeft={<span>meta</span>}>
        <div>x</div>
      </ViewerShell>,
    );
    expect(container.querySelector('.jini-viewer-toolbar-actions')).toBeNull();
  });
});

describe('ViewerEmptyState', () => {
  it('renders its message', () => {
    render(<ViewerEmptyState>Nothing to show</ViewerEmptyState>);
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });
});

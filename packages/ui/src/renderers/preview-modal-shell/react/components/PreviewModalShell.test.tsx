import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../react/i18n.js';
import { PreviewModalShell, type PreviewModalView } from './PreviewModalShell.js';

/** Swaps in a fake global for the duration of `run()`, restoring the previous value afterward — used for `ResizeObserver`, which jsdom doesn't define by default. Same helper shape as `annotation-canvas`'s test suite. */
function withGlobal<T>(key: 'ResizeObserver', value: T, run: () => void): void {
  const target = globalThis as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = value;
  try {
    run();
  } finally {
    if (had) target[key] = original;
    else delete target[key];
  }
}

const singleView: PreviewModalView[] = [{ id: 'a', label: 'Design system', html: '<p>hi</p>' }];
const twoViews: PreviewModalView[] = [
  { id: 'a', label: 'First', html: '<p>one</p>' },
  { id: 'b', label: 'Second', html: '<p>two</p>' },
];

afterEach(() => {
  document.body.style.overflow = '';
});

describe('PreviewModalShell — shell chrome', () => {
  it('renders the backdrop dialog with title/subtitle', () => {
    render(<PreviewModalShell title="My Preview" subtitle="A subtitle" views={singleView} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'My Preview preview');
    expect(screen.getByText('My Preview')).toBeInTheDocument();
    expect(screen.getByText('A subtitle')).toBeInTheDocument();
  });

  it('omits the subtitle block when not given', () => {
    render(<PreviewModalShell title="My Preview" views={singleView} onClose={vi.fn()} />);
    expect(screen.queryByText('A subtitle')).not.toBeInTheDocument();
  });

  it('closes on clicking the close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={onClose} />);
    await user.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PreviewModalShell title="T" views={singleView} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewModalShell — tabs', () => {
  it('hides the tab bar for a single view', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows tabs for multiple views and switches the active one on click, firing onView', async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={twoViews} onView={onView} onClose={vi.fn()} />);
    expect(onView).toHaveBeenLastCalledWith('a');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(onView).toHaveBeenLastCalledWith('b');
  });
});

describe('PreviewModalShell — fullscreen toggle', () => {
  it('is hidden while the active view is unavailable or errored, shown otherwise', () => {
    const { rerender } = render(
      <PreviewModalShell title="T" views={[{ id: 'a', label: 'A', unavailable: { message: 'nope' } }]} onClose={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Fullscreen')).not.toBeInTheDocument();

    rerender(<PreviewModalShell title="T" views={[{ id: 'a', label: 'A', error: 'boom' }]} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Fullscreen')).not.toBeInTheDocument();

    rerender(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('enters fullscreen via requestFullscreen and reflects it in the fullscreen icon/label, firing onFullscreenClick', async () => {
    const onFullscreenClick = vi.fn();
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} onFullscreenClick={onFullscreenClick} />);

    const stage = document.querySelector('[data-preview-modal-stage]') as HTMLElement;
    stage.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    await user.click(screen.getByLabelText('Fullscreen'));
    expect(onFullscreenClick).toHaveBeenCalledTimes(1);
    expect(stage.requestFullscreen).toHaveBeenCalledTimes(1);
    await screen.findByLabelText('Exit fullscreen');
  });

  it('still flips to fullscreen when requestFullscreen rejects (caught, no unhandled rejection)', async () => {
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
    const stage = document.querySelector('[data-preview-modal-stage]') as HTMLElement;
    stage.requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));

    await user.click(screen.getByLabelText('Fullscreen'));
    await screen.findByLabelText('Exit fullscreen');
  });

  it('falls back to plain state toggling when requestFullscreen is unavailable, and exits via the same button', async () => {
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
    await user.click(screen.getByLabelText('Fullscreen'));
    expect(await screen.findByLabelText('Exit fullscreen')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Exit fullscreen'));
    expect(await screen.findByLabelText('Fullscreen')).toBeInTheDocument();
  });
});

describe('PreviewModalShell — sidebar', () => {
  const sidebar = { label: 'Details', content: <div>side content</div> };

  it('shows no sidebar affordances when sidebar is omitted', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });

  it('toggles open via the header button and closed via the collapse handle, firing onSidebarToggleClick', async () => {
    const onSidebarToggleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={sidebar} onSidebarToggleClick={onSidebarToggleClick} />,
    );
    expect(screen.queryByText('side content')).not.toBeInTheDocument();

    await user.click(screen.getByTitle('Details'));
    expect(onSidebarToggleClick).toHaveBeenCalledWith(true);
    expect(screen.getByText('side content')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Hide Details'));
    expect(onSidebarToggleClick).toHaveBeenCalledWith(false);
    expect(screen.queryByText('side content')).not.toBeInTheDocument();
  });

  it('reopens via the stage-edge expand handle', async () => {
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={sidebar} />);
    await user.click(screen.getByLabelText('Show Details'));
    expect(screen.getByText('side content')).toBeInTheDocument();
  });

  it('fires onSidebarToggleClick from the stage-edge expand handle too', async () => {
    const onSidebarToggleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={sidebar} onSidebarToggleClick={onSidebarToggleClick} />,
    );
    await user.click(screen.getByLabelText('Show Details'));
    expect(onSidebarToggleClick).toHaveBeenCalledWith(true);
  });

  it('hides the header toggle button (but not the edge handle) when hideSidebarToggle is set', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={sidebar} hideSidebarToggle />);
    expect(screen.queryByTitle('Details')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show Details')).toBeInTheDocument();
  });

  it('starts open when sidebar.defaultOpen is true', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={{ ...sidebar, defaultOpen: true }} />);
    expect(screen.getByText('side content')).toBeInTheDocument();
  });

  it('fires sidebar.onToggle on mount and on toggle', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} sidebar={{ ...sidebar, onToggle }} />);
    expect(onToggle).toHaveBeenCalledWith(false);
    onToggle.mockClear();
    await user.click(screen.getByTitle('Details'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe('PreviewModalShell — headerExtras', () => {
  it('renders headerExtras in the actions row', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} headerExtras={<button>Extra</button>} />);
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument();
  });
});

describe('PreviewModalShell — primary action', () => {
  it('renders a plain button that calls onClick, and reflects busy/disabled state', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewModalShell title="T" views={singleView} onClose={vi.fn()} primaryAction={{ label: 'Use', onClick, testId: 'use-btn' }} />,
    );
    const btn = screen.getByTestId('use-btn');
    expect(btn).toHaveTextContent('Use');
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <PreviewModalShell
        title="T"
        views={singleView}
        onClose={vi.fn()}
        primaryAction={{ label: 'Use', onClick, busy: true, busyLabel: 'Using…', disabled: false, testId: 'use-btn' }}
      />,
    );
    const busyBtn = screen.getByTestId('use-btn');
    expect(busyBtn).toHaveTextContent('Using…');
    expect(busyBtn).toHaveAttribute('aria-busy', 'true');
    expect(busyBtn).toBeDisabled();
  });

  it('renders a split button with a menu, closes on outside click, and fires the picked item', async () => {
    const onClick = vi.fn();
    const itemClick = vi.fn();
    const user = userEvent.setup();
    render(
      <PreviewModalShell
        title="T"
        views={singleView}
        onClose={vi.fn()}
        primaryAction={{
          label: 'Use',
          onClick,
          testId: 'use-btn',
          menu: [{ label: 'Use with query', description: 'desc', onClick: itemClick, testId: 'menu-item' }],
        }}
      />,
    );
    const caret = screen.getByLabelText('More ways to Use');
    expect(caret).toHaveAttribute('aria-expanded', 'false');

    await user.click(caret);
    expect(caret).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('desc')).toBeInTheDocument();

    await user.click(screen.getByTestId('menu-item'));
    expect(itemClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(caret);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('omits data-testid and falls back to the label while busy with no busyLabel, for the plain button', () => {
    render(
      <PreviewModalShell title="T" views={singleView} onClose={vi.fn()} primaryAction={{ label: 'Use', onClick: vi.fn(), busy: true }} />,
    );
    const btn = screen.getByRole('button', { name: 'Use' });
    expect(btn).not.toHaveAttribute('data-testid');
    expect(btn).toHaveTextContent('Use');
  });

  it('omits data-testid on the split button/caret while busy with no busyLabel (both fall back to the label)', () => {
    render(
      <PreviewModalShell
        title="T"
        views={singleView}
        onClose={vi.fn()}
        primaryAction={{ label: 'Use', onClick: vi.fn(), busy: true, menu: [{ label: 'Alt', onClick: vi.fn() }] }}
      />,
    );
    const caret = screen.getByLabelText('More ways to Use');
    expect(caret).not.toHaveAttribute('data-testid');
    expect(caret).toBeDisabled();
    const mainButtons = screen.getAllByRole('button', { name: 'Use' });
    expect(mainButtons[0]).not.toHaveAttribute('data-testid');
  });

  it('omits data-testid on a menu item and skips the description span when neither is given', async () => {
    const user = userEvent.setup();
    render(
      <PreviewModalShell
        title="T"
        views={singleView}
        onClose={vi.fn()}
        primaryAction={{ label: 'Use', onClick: vi.fn(), menu: [{ label: 'Alt', onClick: vi.fn() }] }}
      />,
    );
    await user.click(screen.getByLabelText('More ways to Use'));
    const item = screen.getByRole('menuitem', { name: 'Alt' });
    expect(item).not.toHaveAttribute('data-testid');
    expect(screen.queryByText('desc')).not.toBeInTheDocument();
  });
});

describe('PreviewModalShell — content stage states', () => {
  it('renders a custom stage as-is, alongside the fullscreen toggle', () => {
    render(
      <PreviewModalShell
        title="T"
        views={[{ id: 'a', label: 'A', custom: <div>custom node</div> }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('custom node')).toBeInTheDocument();
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('renders the unavailable message', () => {
    render(
      <PreviewModalShell
        title="T"
        views={[{ id: 'a', label: 'A', unavailable: { message: 'Nothing to preview here.' } }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Nothing to preview here.')).toBeInTheDocument();
  });

  it('renders the error state with Retry wired to onView', async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(
      <PreviewModalShell title="T" views={[{ id: 'a', label: 'A', error: 'boom' }]} onView={onView} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    onView.mockClear();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onView).toHaveBeenCalledWith('a');
  });

  it('omits the Retry button when onView is not supplied', () => {
    render(<PreviewModalShell title="T" views={[{ id: 'a', label: 'A', error: 'boom' }]} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders a loading placeholder when html is null or undefined', () => {
    const { rerender } = render(
      <PreviewModalShell title="T" views={[{ id: 'a', label: 'My View', html: null }]} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Loading my view…')).toBeInTheDocument();

    rerender(<PreviewModalShell title="T" views={[{ id: 'a', label: 'My View' }]} onClose={vi.fn()} />);
    expect(screen.getByText('Loading my view…')).toBeInTheDocument();
  });

  it('falls back to a generic loading label when there is no active view at all', () => {
    render(<PreviewModalShell title="T" views={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Loading preview…')).toBeInTheDocument();
  });

  it('renders the ready state through SrcDocSandbox with the html and a title built from view label', () => {
    render(<PreviewModalShell title="My Title" views={singleView} onClose={vi.fn()} />);
    const iframe = screen.getByTitle('My Title Design system') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.srcdoc).toContain('<p>hi</p>');
  });

  it('forwards srcDocOptions into the built srcDoc', () => {
    render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} srcDocOptions={{ csp: false }} />);
    const iframe = screen.getByTitle('T Design system') as HTMLIFrameElement;
    expect(iframe.srcdoc).not.toContain('Content-Security-Policy');
  });
});

describe('PreviewModalShell — icon overrides', () => {
  it('renders a caller-supplied icon override in place of the default', () => {
    render(
      <PreviewModalShell
        title="T"
        views={singleView}
        onClose={vi.fn()}
        icons={{ close: () => <span data-testid="custom-close-icon" /> }}
      />,
    );
    expect(screen.getByTestId('custom-close-icon')).toBeInTheDocument();
  });
});

describe('PreviewModalShell — i18n wiring', () => {
  it('renders translated copy end-to-end when mounted under an I18nProvider with a dictionary', () => {
    render(
      <I18nProvider
        dictionary={{
          '{title} preview': '{title} — aperçu',
          Close: 'Fermer',
          'Something went wrong.': 'Une erreur est survenue.',
        }}
      >
        <PreviewModalShell title="Mon titre" views={[{ id: 'a', label: 'A', error: 'boom' }]} onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Mon titre — aperçu');
    expect(screen.getByLabelText('Fermer')).toBeInTheDocument();
    expect(screen.getByText('Une erreur est survenue.')).toBeInTheDocument();
  });
});

describe('PreviewModalShell — stage measurement', () => {
  it('re-measures via ResizeObserver when available and updates the scaler style', () => {
    class TrackingRO {
      cb: ResizeObserverCallback;
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
    }
    let instance: TrackingRO | undefined;
    class TrackedRO extends TrackingRO {
      constructor(cb: ResizeObserverCallback) {
        super(cb);
        instance = this;
      }
    }

    withGlobal('ResizeObserver', TrackedRO as unknown as typeof ResizeObserver, () => {
      render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
      const frame = document.querySelector('[data-preview-modal-stage-frame]') as HTMLElement;
      Object.defineProperty(frame, 'clientWidth', { value: 640, configurable: true });
      Object.defineProperty(frame, 'clientHeight', { value: 480, configurable: true });
      expect(instance).toBeDefined();
      act(() => instance!.cb([], instance as unknown as ResizeObserver));

      const scaler = document.querySelector('[data-preview-modal-stage-scaler]') as HTMLElement;
      expect(scaler.style.transform).toBe('scale(0.5)');
    });
  });

  it('falls back to a window resize listener when ResizeObserver is unavailable', () => {
    withGlobal('ResizeObserver', undefined as unknown as typeof ResizeObserver, () => {
      render(<PreviewModalShell title="T" views={singleView} onClose={vi.fn()} />);
      const frame = document.querySelector('[data-preview-modal-stage-frame]') as HTMLElement;
      Object.defineProperty(frame, 'clientWidth', { value: 320, configurable: true });
      Object.defineProperty(frame, 'clientHeight', { value: 240, configurable: true });
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      const scaler = document.querySelector('[data-preview-modal-stage-scaler]') as HTMLElement;
      expect(scaler.style.transform).toBe('scale(0.25)');
    });
  });
});

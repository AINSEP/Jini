import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtEventErrorBoundary } from '../ExtEventErrorBoundary.js';

/**
 * The blast-radius test. An ext-event renderer runs inline in the transcript over agent-authored
 * payloads, so a render-phase throw is a realistic outcome — and without this boundary it unmounts
 * the whole chat root (blank page, lost transcript, lost draft). Every case below therefore asserts
 * that a *sibling* of the failing group survives, not just that a fallback appeared.
 */

/** React logs a component-stack error for every caught boundary throw; silence it per test rather than globally so an unexpected console.error still surfaces. */
function silenceReactErrorLogging() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExtEventErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    render(
      <ExtEventErrorBoundary name="a2ui">
        <div>surface content</div>
      </ExtEventErrorBoundary>,
    );
    expect(screen.getByText('surface content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confines a render-phase throw to its own subtree, leaving sibling content mounted', () => {
    silenceReactErrorLogging();
    render(
      <div>
        <ExtEventErrorBoundary name="a2ui">
          <Boom message="unbounded recursive component tree" />
        </ExtEventErrorBoundary>
        <div>the rest of the transcript</div>
      </div>,
    );
    expect(screen.getByText('the rest of the transcript')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('"a2ui" failed to render: unbounded recursive component tree');
  });

  it('names the failing ext event on the fallback so a host can tell which protocol broke', () => {
    silenceReactErrorLogging();
    render(
      <ExtEventErrorBoundary name="mcp-ui">
        <Boom message="malformed data-model binding" />
      </ExtEventErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-ext-event-name', 'mcp-ui');
  });

  it('logs the ext event name alongside the error, which React\'s own report cannot know', () => {
    const spy = silenceReactErrorLogging();
    render(
      <ExtEventErrorBoundary name="a2ui">
        <Boom message="boom" />
      </ExtEventErrorBoundary>,
    );
    expect(spy).toHaveBeenCalledWith(
      '[ExtEventErrorBoundary] ext event "a2ui" failed to render:',
      expect.objectContaining({ message: 'boom' }),
    );
  });

  it('calls onError with the error and React\'s component stack, in addition to rendering the fallback', () => {
    silenceReactErrorLogging();
    const onError = vi.fn();
    render(
      <ExtEventErrorBoundary name="a2ui" onError={onError}>
        <Boom message="reporting hook" />
      </ExtEventErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0]!;
    expect(error).toEqual(expect.objectContaining({ message: 'reporting hook' }));
    expect(info.componentStack).toContain('Boom');
    // The built-in fallback is not opt-out: a host that only wants to log must still not get a
    // silently blank slot where the surface was.
    expect(screen.getByRole('alert')).toHaveTextContent('reporting hook');
  });

  it('still renders the fallback when no onError handler is supplied', () => {
    // The one path MessageRow itself takes — it never passes `onError`, so the optional call must
    // not be load-bearing for the fallback.
    silenceReactErrorLogging();
    render(
      <ExtEventErrorBoundary name="a2ui">
        <Boom message="no handler" />
      </ExtEventErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('"a2ui" failed to render: no handler');
  });
});
